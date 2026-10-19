"""Read-only usage, alert and repricing insights over observed gateway records.

Money is summed by currency with Decimal. A missing bill is never a zero bill.
Replay compares routing choices and current documented prices, not unobserved
historical outcomes. No network, notifications or ledger mutation occur here.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping


UTC = timezone.utc
DEFAULT_POLICY = Path(__file__).resolve().parents[1] / "config/gateway_insights_policy_v1.json"


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(UTC) if parsed.tzinfo is not None else None


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _number(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return number if number.is_finite() and number >= 0 else None


def _money(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _sum(values: list[Decimal]) -> Decimal:
    if not values:
        return Decimal(0)
    # Ledger amounts may exceed the interpreter's default 28 significant digits.
    precision = max(value.adjusted() for value in values) - min(value.as_tuple().exponent for value in values)
    with localcontext() as context:
        context.prec = max(28, precision + len(str(len(values))) + 3)
        return sum(values, Decimal(0))


def _p95(values: list[float]) -> float | None:
    return sorted(values)[math.ceil(len(values) * 0.95) - 1] if values else None


def _real(record: Mapping[str, Any]) -> bool:
    mock = record.get("is_mock")
    return not (mock is True or str(mock).upper() == "TRUE"
                or record.get("source_type") in {"mock", "simulation", "simulated"}
                or record.get("fault_injected") is True
                or record.get("is_fault_injected") is True
                or record.get("injected") is True
                or record.get("is_injected") is True
                or any(not _real(attempt) for attempt in record.get("attempts", []) if isinstance(attempt, dict)))


def _actual(record: Mapping[str, Any]) -> Decimal | None:
    if record.get("status") == "in_progress" or record.get("cost_status") in {
        "reserved", "unknown", "partial", "unpriced", "pending"
    }:
        return None
    return _number(record.get("actual_cost"))


def _observed(record: Mapping[str, Any]) -> bool:
    return (isinstance(record.get("success"), bool)
            and record.get("status") not in {"in_progress", "blocked", "rejected", "not_executed"}
            and record.get("execution_attempted") is not False
            and record.get("network_called") is not False
            and record.get("stop_reason") != "no_available_channel")


def _channel(record: Mapping[str, Any]) -> str:
    return str(record.get("final_channel") or record.get("selected_channel") or "unknown")


def _latencies(records: list[dict]) -> list[float]:
    return [float(number) for record in records if _observed(record)
            and (number := _number(record.get("latency_ms"))) is not None]


def _channel_samples(records: list[dict]) -> list[dict]:
    """Attempt evidence prevents a successful fallback from hiding a failure."""
    samples = []
    for record in records:
        attempts = [attempt for attempt in record.get("attempts", [])
                    if isinstance(attempt, dict) and isinstance(attempt.get("success"), bool)]
        if not attempts:
            if _observed(record):
                samples.append(record)
            continue
        for attempt in attempts:
            channel = attempt.get("channel_id") or attempt.get("channel")
            if not isinstance(channel, str) or not channel:
                continue
            sample = {**record, **attempt, "final_channel": channel, "selected_channel": channel,
                      "status": "success" if attempt["success"] else "failed",
                      "latency_ms": attempt.get("latency_ms")}
            if channel != _channel(record):
                sample["identity"] = {}
            if _observed(sample):
                samples.append(sample)
    return samples


def _period_start(now: datetime, period: str) -> datetime:
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "day":
        return midnight
    if period == "week":
        return midnight - timedelta(days=now.weekday())
    if period == "month":
        return midnight.replace(day=1)
    raise ValueError("period must be day, week or month")


def _bucket(at: datetime, period: str) -> str:
    return _iso(_period_start(at, period))


class GatewayInsightsService:
    """Pure analysis with an injectable UTC clock for repeatable tests."""

    def __init__(self, policy: Mapping[str, Any] | str | Path | None = None,
                 clock: Callable[[], datetime] | None = None):
        defaults = json.loads(DEFAULT_POLICY.read_text(encoding="utf-8"))
        if isinstance(policy, (str, Path)):
            defaults.update(json.loads(Path(policy).read_text(encoding="utf-8")))
        elif policy is not None:
            defaults.update(dict(policy))
        self.policy = defaults
        self.clock = clock or (lambda: datetime.now(UTC))
        if (isinstance(defaults["minimum_samples"], bool)
                or not isinstance(defaults["minimum_samples"], int)
                or defaults["minimum_samples"] < 5):
            raise ValueError("minimum_samples must be at least 5")
        for key in ("window_seconds", "cooldown_seconds", "p95_latency_threshold_ms", "p95_increase_ratio"):
            if _number(defaults.get(key)) is None or Decimal(str(defaults[key])) <= 0:
                raise ValueError(f"invalid {key}")
        for key in ("success_rate_threshold", "price_change_ratio", "quota_remaining_ratio"):
            value = _number(defaults.get(key))
            if value is None or value > 1:
                raise ValueError(f"invalid {key}")

    def _now(self) -> datetime:
        now = self.clock()
        if now.tzinfo is None:
            raise ValueError("clock must provide a timezone-aware datetime")
        return now.astimezone(UTC)

    def _records(self, records: list, filters: Mapping[str, Any] | None = None,
                 start: datetime | None = None, end: datetime | None = None) -> list[dict]:
        filters = filters or {}
        now = self._now()
        date_from = _time(filters.get("date_from")) if filters.get("date_from") else start
        date_to = _time(filters.get("date_to")) if filters.get("date_to") else end
        if filters.get("date_from") and date_from is None:
            raise ValueError("date_from must include a timezone")
        if filters.get("date_to") and date_to is None:
            raise ValueError("date_to must include a timezone")
        if date_from and date_to and date_from > date_to:
            raise ValueError("date_from must not follow date_to")
        accepted = []
        for record in records:
            if not isinstance(record, dict) or not _real(record):
                continue
            at = _time(record.get("occurred_at"))
            if at is None or at > now or (date_from and at < date_from) or (date_to and at >= date_to):
                continue
            if record.get("completed_at") is not None:
                completed = _time(record["completed_at"])
                if completed is None or completed > now or completed < at:
                    continue
            if any(filters.get(key) is not None and record.get(key) != filters[key]
                   for key in ("model_id", "project_id", "user_id", "currency", "status")):
                continue
            if filters.get("channel_id") is not None and _channel(record) != filters["channel_id"]:
                continue
            accepted.append(deepcopy(record))
        return sorted(accepted, key=lambda item: (item["occurred_at"], str(item.get("request_id", ""))))

    @staticmethod
    def _summary(records: list[dict]) -> dict:
        actual = [_actual(record) for record in records]
        estimated = [_number(record.get("estimated_cost")) for record in records]
        actual_known = [value for value in actual if value is not None]
        estimated_known = [value for value in estimated if value is not None]
        partial_known = [_number(record.get("actual_cost")) for record in records
                         if _actual(record) is None and record.get("status") != "in_progress"]
        partial_known = [value for value in partial_known if value is not None]
        comparable = [(a, e) for a, e in zip(actual, estimated) if a is not None and e is not None]
        observed = [record for record in records if _observed(record)]
        latencies = _latencies(records)
        attempts = [attempt for record in records for attempt in record.get("attempts", [])
                    if isinstance(attempt, dict)]
        return {
            "request_count": len(records),
            "executed_sample_count": len(observed),
            "success_count": sum(record["success"] for record in observed),
            "failure_count": sum(not record["success"] for record in observed),
            "success_rate": sum(record["success"] for record in observed) / len(observed) if observed else None,
            "success_rate_denominator": "executed requests with an observed boolean success",
            "average_latency_ms": sum(latencies) / len(latencies) if latencies else None,
            "latency_sample_count": len(latencies),
            "p95_latency_ms": _p95(latencies),
            "actual_cost": _money(_sum(actual_known)) if actual_known else None,
            "estimated_cost": _money(_sum(estimated_known)) if estimated_known else None,
            "unsettled_known_cost_subtotal": _money(_sum(partial_known)) if partial_known else None,
            "unsettled_known_cost_count": len(partial_known),
            "actual_cost_known_count": len(actual_known),
            "actual_cost_unknown_count": len(records) - len(actual_known),
            "estimated_cost_known_count": len(estimated_known),
            "actual_cost_coverage": len(actual_known) / len(records) if records else None,
            "unresolved_count": sum(record.get("status") == "in_progress" or _actual(record) is None
                                    for record in records),
            "comparable_cost_count": len(comparable),
            "actual_minus_estimated": _money(_sum([value for a, e in comparable for value in (a, e.copy_negate())])) if comparable else None,
            "attempt_count": len(attempts),
            "fallback_count": sum(bool(record.get("fallback_trace")) or len(record.get("attempts", [])) > 1
                                  for record in records),
        }

    def analyze(self, records: list, period: str = "month", filters: dict | None = None) -> dict:
        now = self._now()
        start = _period_start(now, period)
        selected = self._records(records, filters, start=start)
        currencies: dict[str, list[dict]] = defaultdict(list)
        unknown_currency = 0
        for record in selected:
            currency = record.get("currency")
            if not isinstance(currency, str) or len(currency) != 3 or not currency.isupper():
                unknown_currency += 1
            else:
                currencies[currency].append(record)
        result = {
            "period": period, "timezone": "UTC", "period_start": _iso(_time((filters or {}).get("date_from")) or start),
            "period_end": (filters or {}).get("date_to") or _iso(now), "as_of": _iso(now),
            "record_count": len(selected), "unknown_currency_count": unknown_currency,
            "currencies": {}, "channel_cost_attribution": "request final channel; totals may include fallback attempts",
            "source_type": "observed_gateway_ledger", "is_mock": False,
        }
        for currency, currency_records in sorted(currencies.items()):
            data = self._summary(currency_records)
            for name, getter in (
                ("by_model", lambda item: str(item.get("model_id") or "unknown")),
                ("by_channel", _channel),
                ("by_project", lambda item: str(item.get("project_id") or "unknown")),
                ("by_user", lambda item: str(item.get("user_id") or "unknown")),
                ("daily", lambda item: _bucket(_time(item["occurred_at"]), "day")),
                ("weekly", lambda item: _bucket(_time(item["occurred_at"]), "week")),
                ("monthly", lambda item: _bucket(_time(item["occurred_at"]), "month")),
            ):
                groups: dict[str, list[dict]] = defaultdict(list)
                for record in currency_records:
                    groups[getter(record)].append(record)
                data[name] = [{"key": key, **self._summary(group)} for key, group in sorted(groups.items())]
            result["currencies"][currency] = data
        return result

    def alerts(self, records: list, offers: list | None = None, previous_prices: list | None = None,
               current_prices: list | None = None, quotas: list | None = None) -> list:
        now = self._now()
        window = timedelta(seconds=float(self.policy["window_seconds"]))
        history = self._records(records, start=now - window * 2)
        current = _channel_samples([record for record in history if _time(record["occurred_at"]) >= now - window])
        baseline = _channel_samples([record for record in history if _time(record["occurred_at"]) < now - window])
        alerts = []

        def emit(kind: str, severity: str, channel: str | None, model: str | None,
                 message: str, count: int = 0, **detail: Any) -> None:
            fingerprint = json.dumps([kind, channel, model, detail.get("currency"), detail.get("price_field"),
                                      detail.get("billing_unit"), detail.get("price_tier")], sort_keys=True, separators=(",", ":"))
            alert_id = hashlib.sha256(fingerprint.encode()).hexdigest()[:24]
            alerts.append({"alert_id": alert_id, "fingerprint": alert_id, "severity": severity,
                           "type": kind, "channel_id": channel, "model_id": model, "message": message,
                           "sample_count": count, "observed_at": _iso(now),
                           "cooldown_seconds": self.policy["cooldown_seconds"],
                           "notification_mode": "in_app_read_only", **detail})

        groups: dict[tuple[str, str | None], list[dict]] = defaultdict(list)
        for record in current:
            groups[(_channel(record), record.get("model_id"))].append(record)
        minimum = int(self.policy["minimum_samples"])
        for (channel, model), group in sorted(groups.items(), key=lambda item: str(item[0])):
            observed = [record for record in group if _observed(record)]
            if len(observed) < minimum:
                emit("insufficient_observations", "info", channel, model,
                     "Not enough observed requests to assess the SLA.", len(observed), minimum_samples=minimum)
            else:
                rate = sum(record["success"] for record in observed) / len(observed)
                if rate < self.policy["success_rate_threshold"]:
                    emit("success_rate_below_threshold", "warning", channel, model,
                         "Observed success rate is below the configured SLA.", len(observed),
                         success_rate=rate, threshold=self.policy["success_rate_threshold"])
            latencies = _latencies(group)
            if len(latencies) >= minimum:
                p95 = _p95(latencies)
                if p95 > self.policy["p95_latency_threshold_ms"]:
                    emit("p95_latency_high", "warning", channel, model,
                         "Observed P95 latency exceeds the configured limit.", len(latencies), p95_latency_ms=p95)
                previous = _latencies([record for record in baseline if _channel(record) == channel and record.get("model_id") == model])
                old = _p95(previous)
                if len(previous) >= minimum and old is not None and old > 0 and p95 / old >= self.policy["p95_increase_ratio"]:
                    emit("p95_latency_increase", "warning", channel, model,
                         "Observed P95 increased compared with the preceding equal-length window.", len(latencies),
                         p95_latency_ms=p95, baseline_p95_latency_ms=old, baseline_sample_count=len(previous))
            elif len(observed) >= minimum:
                emit("insufficient_latency_observations", "info", channel, model,
                     "Latency coverage is insufficient to assess P95.", len(latencies), minimum_samples=minimum)
            mismatches = [record for record in group if (record.get("identity") or {}).get("verification_status") in {"mismatch", "model_mismatch", "billed_model_mismatch"}]
            if mismatches:
                emit("model_identity_mismatch", "critical", channel, model,
                     "Recorded model identity verification reported a mismatch.", len(mismatches),
                     request_ids=sorted(str(record.get("request_id", "")) for record in mismatches))
        for offer in offers or []:
            if not isinstance(offer, dict) or not _real(offer):
                continue
            if offer.get("availability_status") in {"retired", "unavailable", "disabled", "sunset"} or (
                    _time(offer.get("sunset_at")) is not None and _time(offer["sunset_at"]) <= now):
                emit("model_offer_unavailable", "warning", offer.get("channel_id"), offer.get("model_id"),
                     "The provider offer is recorded as retired or unavailable.")
        old_prices = self._price_rows(previous_prices or [], now, historical=True)
        for key, current_price in self._price_rows(current_prices or [], now).items():
            previous = old_prices.get(key)
            if previous is None:
                continue
            for field in ("input_price", "output_price", "cached_input_price", "price"):
                before, after = _number(previous.get(field)), _number(current_price.get(field))
                if before is None or after is None or before == after:
                    continue
                change = (after - before) / before if before else None
                if change is None or abs(change) >= Decimal(str(self.policy["price_change_ratio"])):
                    emit("price_change", "warning", current_price["channel_id"], current_price["model_id"],
                         "Comparable documented price changed beyond the configured threshold.",
                         currency=current_price["currency"], price_field=field,
                         before=_money(before), after=_money(after), relative_change=str(change) if change is not None else None,
                         billing_unit=key[2], price_tier=json.loads(key[4]))
        for quota in quotas or []:
            if not isinstance(quota, dict) or not _real(quota):
                continue
            observed_at = _time(quota.get("observed_at"))
            if observed_at is None or observed_at > now:
                continue
            limit, remaining = _number(quota.get("limit")), _number(quota.get("remaining"))
            if limit is None or remaining is None or limit <= 0 or remaining > limit:
                emit("quota_unknown", "info", quota.get("channel_id"), quota.get("model_id"),
                     "Quota information is incomplete or invalid.")
            elif remaining / limit <= Decimal(str(self.policy["quota_remaining_ratio"])):
                emit("quota_low", "warning", quota.get("channel_id"), quota.get("model_id"),
                     "Recorded quota remaining is below the configured threshold.",
                     remaining=_money(remaining), limit=_money(limit), quota_observed_at=_iso(observed_at))
        # Same alert identity represents one active condition, not repeated outbound notifications.
        return sorted({item["alert_id"]: item for item in alerts}.values(), key=lambda item: (item["type"], item["alert_id"]))

    @staticmethod
    def _price_rows(rows: list, now: datetime, historical: bool = False) -> dict:
        comparable = {}
        for row in rows:
            if not isinstance(row, dict) or not _real(row):
                continue
            unit = row.get("billing_unit") or row.get("price_unit")
            if not all(row.get(field) for field in ("model_id", "channel_id", "currency")) or not unit:
                continue
            effective = _time(row.get("effective_from") or row.get("effective_at"))
            verified = _time(row.get("verified_at"))
            if effective is None or effective > now or verified is None or verified > now:
                continue
            end = _time(row.get("effective_until"))
            if end is not None and (effective >= end or (not historical and now >= end)):
                continue
            if row.get("verification_status") not in {"verified", "provider_documented", "documented"}:
                continue
            tier = {"tier": row.get("tier", row.get("context_tier", {})),
                    **{field: row[field] for field in ("input_tokens_min", "input_tokens_max", "region", "pricing_mode") if field in row}}
            key = (row["model_id"], row["channel_id"], unit, row["currency"], json.dumps(tier, sort_keys=True))
            if key not in comparable or verified > _time(comparable[key]["verified_at"]):
                comparable[key] = row
        return comparable

    def replay(self, records: list, request: dict, provider_service: Any) -> dict:
        objective = request.get("objective", "balanced")
        if objective not in {"lowest_cost", "highest_reliability", "balanced"}:
            raise ValueError("unsupported replay objective")
        excluded = request.get("excluded_channels", [])
        if not isinstance(excluded, list) or any(not isinstance(channel, str) for channel in excluded):
            raise ValueError("excluded_channels must be a list of channel identifiers")
        filters = dict(request.get("filters") or {})
        for field in ("model_id", "project_id", "user_id", "currency", "channel_id", "date_from", "date_to"):
            if request.get(field) is not None:
                filters[field] = request[field]
        history = self._records(records)
        period = request.get("period")
        start = _period_start(self._now(), period) if period is not None else None
        selected = self._records(records, filters, start=start)
        rows = []
        deltas: dict[str, list[Decimal]] = defaultdict(list)
        for record in selected:
            at = _time(record["occurred_at"])
            # Strictly prior evidence excludes the target itself and simultaneous requests.
            observations = [deepcopy(item) for item in history if _time(item["occurred_at"]) < at
                            and (_time(item.get("completed_at")) or _time(item["occurred_at"])) < at
                            and item.get("status") != "in_progress"]
            profile = deepcopy(record.get("request_profile") or {})
            tokens = {key: profile.get(key, record.get(key)) for key in ("input_tokens", "output_tokens", "cached_input_tokens")}
            token_sources = {key: ("unknown" if tokens[key] is None else
                                   "recorded_request_profile_estimate" if key in profile else "observed_request_usage")
                             for key in tokens}
            counts_known = all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in tokens.values())
            row = {"request_id": record.get("request_id"), "occurred_at": record["occurred_at"],
                   "original_channel": _channel(record), "selected_channel": None,
                   "currency": record.get("currency"), "observations_before_request": len(observations),
                   "token_basis": token_sources,
                   "scenario_price_basis": "current_documented_price", "historical_price_available": False,
                   "execution_outcome_counterfactual": "unknown", "actual_baseline_cost": _money(_actual(record)),
                   "scenario_estimated_cost": None, "baseline_estimated_cost": record.get("estimated_cost"),
                   "comparable_estimated_savings": None, "reason": []}
            if not counts_known:
                row["reason"].append("Token counts are unknown; no cost counterfactual was calculated.")
                rows.append(row)
                continue
            compare_request = {**profile, **tokens, "model_id": record.get("model_id"), "objective": objective,
                               "excluded_channels": list(excluded),
                               "currency": record.get("currency"), "observations_as_of": record["occurred_at"]}
            comparison = provider_service.compare(compare_request, observations=observations)
            selected_channel = comparison.get("selected_channel")
            row["selected_channel"] = selected_channel
            row["reason"] = deepcopy((comparison.get("recommendation") or {}).get("reason") or [])
            if isinstance(row["reason"], str):
                row["reason"] = [row["reason"]]
            offer = next((item for item in comparison.get("offers", []) if item.get("channel_id") == selected_channel), {})
            quote = offer.get("estimated_cost")
            if isinstance(quote, Mapping):
                value = quote.get("total_cost", quote.get("total", quote.get("estimated_total_cost")))
                currency = quote.get("currency", offer.get("currency"))
            else:
                value, currency = quote, offer.get("currency", comparison.get("currency"))
            scenario = _number(value)
            if currency == record.get("currency") and scenario is not None:
                row["scenario_estimated_cost"] = _money(scenario)
                # Compare original and alternative quotes from the SAME current price scenario.
                original = next((item for item in comparison.get("offers", []) if item.get("channel_id") == _channel(record)), {})
                original_quote = original.get("estimated_cost")
                if isinstance(original_quote, Mapping):
                    original_currency = original_quote.get("currency", original.get("currency"))
                    original_cost = _number(original_quote.get("total_cost", original_quote.get("total", original_quote.get("estimated_total_cost"))))
                else:
                    original_currency = original.get("currency", comparison.get("currency"))
                    original_cost = _number(original_quote)
                if original_currency == currency and original_cost is not None:
                    difference = _sum([original_cost, scenario.copy_negate()])
                    row["baseline_current_price_estimate"] = _money(original_cost)
                    row["comparable_estimated_savings"] = _money(difference)
                    deltas[currency].append(difference)
            if row["scenario_estimated_cost"] is None:
                row["reason"].append("No usable same-currency current documented quote; pricing coverage is unknown.")
            rows.append(row)
        return {"objective": objective, "request_count": len(rows), "rows": rows,
                "channel_change_count": sum(row["selected_channel"] is not None and row["selected_channel"] != row["original_channel"] for row in rows),
                "priced_count": sum(row["scenario_estimated_cost"] is not None for row in rows),
                "pricing_coverage": sum(row["scenario_estimated_cost"] is not None for row in rows) / len(rows) if rows else None,
                "estimated_savings_by_currency": {currency: {"estimated_savings": _money(_sum(values)), "comparable_count": len(values)} for currency, values in sorted(deltas.items())},
                "scenario_price_basis": "current_documented_price", "execution_outcome_counterfactual": "unknown",
                "observation_time_basis": "completed_at when available; otherwise recorded event time",
                "limitations": ["Current-price repricing is not a historical bill reconstruction.",
                                "Unexecuted channel success, latency and duplicate billing are unknown.",
                                "Only observations strictly before each historic request inform its reliability comparison."],
                "is_mock": False, "source_type": "read_only_counterfactual_analysis"}
