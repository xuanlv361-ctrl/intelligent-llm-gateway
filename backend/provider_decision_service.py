"""Explainable provider comparison over documented quotes and local evidence.

This layer never enables a provider adapter. Account capabilities and privacy
controls require explicit evidence; documentation alone is not an account test.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping

from src.model_market_catalog import (
    compare_model_channels, load_cost_catalog, load_mapping,
    validate_market_catalog,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ACCESS_POLICY = ROOT / "config" / "provider_access_policy_v1.json"
OBJECTIVES = {"balanced", "lowest_cost", "lowest_latency", "highest_reliability"}


class ProviderDecisionError(ValueError):
    """Invalid comparison request or invalid local access configuration."""


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def _quantile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return round(ordered[low] + (ordered[high] - ordered[low]) * (position - low), 6)


def _identity_token(value: str) -> str:
    # Explicit identifiers are case insensitive. Do not strip path components,
    # punctuation or model versions: that would admit unrelated provider IDs.
    return value.strip().casefold()


def verify_model_identity(requested_model: str, offer: Mapping[str, Any],
                          actual_model: str | None = None,
                          billed_model: str | None = None,
                          observed_at: str | None = None) -> dict[str, Any]:
    """Compare provider self-reports to the offer's explicit identifiers only.

    A matching response field is evidence of a self-report, not proof of model
    weights or a billing invoice. Unobserved values are never manufactured.
    """
    alias = offer.get("provider_model_id")
    approved = {str(alias), str(offer.get("model_id", ""))}
    configured = offer.get("approved_returned_model_ids", [])
    if isinstance(configured, list):
        approved.update(item for item in configured if isinstance(item, str))
    if offer.get("model_id_kind") == "rolling_alias":
        resolved = offer.get("resolved_version_at_verification")
        if isinstance(resolved, str):
            approved.add(resolved)
    approved_tokens = {_identity_token(item) for item in approved if item}
    reasons = []
    seen = False
    for label, value in (("actual_model", actual_model), ("billed_model", billed_model)):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            if value != "":
                raise ProviderDecisionError(f"{label} must be a model identifier or null")
            value = None
        if value:
            seen = True
            if _identity_token(value) not in approved_tokens:
                reasons.append(f"{label}_mismatch")
    stamp = _parse_time(observed_at)
    return {
        "requested_model": requested_model,
        "provider_model_alias": alias,
        "actual_returned_model": actual_model or None,
        "billed_model": billed_model or None,
        "verification_status": "mismatch" if reasons else (
            "self_reported_match" if seen else "pending_confirmation"),
        "last_verified_at": _iso(stamp) if seen and stamp else None,
        "mismatch_reasons": reasons,
        "evidence_note": "Provider-returned identifiers do not cryptographically verify model identity or billing.",
    }


def _unknown_access() -> dict[str, Any]:
    return {
        "stream": "unknown", "tool_calling": "unknown", "max_context_tokens": None,
        "storage_regions": [], "retention_days": None, "training_use": "unknown",
        "sensitive_tasks_allowed": False, "compliance_labels": [],
        "verification_status": "pending_confirmation", "source_urls": [], "verified_at": None,
    }


class ProviderDecisionService:
    def __init__(self, mapping: Mapping[str, Any] | None = None,
                 cost_catalog: Mapping[str, Any] | None = None,
                 access_policy: Mapping[str, Any] | str | Path | None = None,
                 clock: Callable[[], datetime] | None = None):
        self.mapping = deepcopy(load_mapping() if mapping is None else dict(mapping))
        self.cost_catalog = deepcopy(load_cost_catalog() if cost_catalog is None else dict(cost_catalog))
        validate_market_catalog(self.mapping, self.cost_catalog)
        if access_policy is None or isinstance(access_policy, (str, Path)):
            path = DEFAULT_ACCESS_POLICY if access_policy is None else Path(access_policy)
            with path.open(encoding="utf-8") as handle:
                self.access_policy = json.load(handle)
        else:
            self.access_policy = deepcopy(dict(access_policy))
        if not isinstance(self.access_policy.get("channels", {}), dict):
            raise ProviderDecisionError("policy.channels must be an object")
        observation = self.access_policy.get("observation_policy", {})
        self.minimum_samples = observation.get("minimum_samples", 5)
        self.window_hours = observation.get("rolling_window_hours", 24)
        for value, label in ((self.minimum_samples, "minimum_samples"),
                             (self.window_hours, "rolling_window_hours")):
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ProviderDecisionError(f"{label} must be a positive integer")
        if self.minimum_samples < 5:
            raise ProviderDecisionError("minimum_samples must be at least 5")
        configured_weights = self.access_policy.get("balanced_weights", {
            "cost": 0.5, "reliability": 0.3, "latency": 0.2,
        })
        if not isinstance(configured_weights, dict) or set(configured_weights) != {"cost", "reliability", "latency"}:
            raise ProviderDecisionError("balanced_weights requires cost, reliability and latency")
        if any(_number(value) is None for value in configured_weights.values()) or sum(
            float(value) for value in configured_weights.values()) <= 0:
            raise ProviderDecisionError("balanced_weights must be finite non-negative with positive sum")
        self.weights = {key: float(value) for key, value in configured_weights.items()}
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _now(self) -> datetime:
        now = self.clock()
        if not isinstance(now, datetime) or now.tzinfo is None:
            raise ProviderDecisionError("clock must return a timezone-aware datetime")
        return now.astimezone(timezone.utc)

    def catalog(self) -> dict[str, Any]:
        now = self._now()
        models = []
        offers = []
        for model_id in sorted(self.mapping["models"]):
            comparison = compare_model_channels(model_id, now=now, mapping=self.mapping,
                                                cost_catalog=self.cost_catalog)
            rows = comparison["offers"]
            for row in rows:
                row["access_policy"] = self._access(row["channel_id"])
                row["identity"] = verify_model_identity(model_id, row)
            models.append({"model_id": model_id, "offer_count": len(rows),
                           "providers": sorted({row["provider"] for row in rows}),
                           "aliases": sorted(alias for alias, canonical in self.mapping.get(
                               "model_aliases", {}).items() if canonical == model_id)})
            offers.extend(rows)
        return {"models": models, "offers": offers, "offer_count": len(offers),
                "as_of": _iso(now), "source_type": "provider_documentation",
                "network_called": False, "execution_enabled": False}

    def _access(self, channel: str) -> dict[str, Any]:
        configured = self.access_policy.get("channels", {}).get(channel, {})
        if not isinstance(configured, dict):
            raise ProviderDecisionError("channel access policy must be an object")
        access = {**_unknown_access(), **deepcopy(configured)}
        for key in ("stream", "tool_calling"):
            if access[key] not in {"unknown", "supported", "unsupported"}:
                raise ProviderDecisionError(f"invalid {key} access policy")
        if access["training_use"] not in {"unknown", "not_used", "used"}:
            raise ProviderDecisionError("invalid training_use policy")
        if not isinstance(access["storage_regions"], list) or any(
            not isinstance(item, str) or not item for item in access["storage_regions"]):
            raise ProviderDecisionError("storage_regions must list exact region identifiers")
        for key in ("max_context_tokens", "retention_days"):
            value = access[key]
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                raise ProviderDecisionError(f"invalid {key} policy")
        if not isinstance(access["sensitive_tasks_allowed"], bool):
            raise ProviderDecisionError("sensitive_tasks_allowed must be boolean")
        return access

    def _health(self, model: str, channel: str, observations: list[dict[str, Any]],
                now: datetime) -> dict[str, Any]:
        lower = now - timedelta(hours=self.window_hours)
        accepted: list[tuple[datetime, dict[str, Any]]] = []
        seen = set()
        for row in observations:
            if not isinstance(row, dict) or row.get("is_mock") is not False:
                continue
            if row.get("model_id") != model:
                continue
            if any(row.get(key) is True for key in ("fault_injected", "is_fault_injected", "injected", "is_injected")):
                continue
            stamp = _parse_time(row.get("occurred_at"))
            if stamp is None or not lower <= stamp <= now:
                continue
            if row.get("completed_at") is not None:
                completed = _parse_time(row["completed_at"])
                if completed is None or completed > now or completed < stamp:
                    continue
            # A successful fallback must not hide the primary channel's failed
            # attempt. An explicit empty trace means no channel was executed.
            if "attempts" in row:
                if not isinstance(row["attempts"], list):
                    continue
                candidates = row["attempts"]
            else:
                candidates = [{**row, "channel_id": row.get("final_channel")}]
            for candidate in candidates:
                if not isinstance(candidate, dict) or candidate.get("channel_id") != channel:
                    continue
                if candidate.get("is_mock", row["is_mock"]) is not False:
                    continue
                if any(candidate.get(key) is True for key in ("fault_injected", "is_fault_injected", "injected", "is_injected")):
                    continue
                if (not isinstance(candidate.get("success"), bool) or candidate.get("execution_attempted") is False
                        or candidate.get("network_called") is False):
                    continue
                if candidate.get("status") in {"blocked", "blocked_capability", "not_executed", "cancelled", "in_progress", "skipped"}:
                    continue
                identity = candidate.get("attempt_id") or row.get("request_id")
                key = (row.get("project_id"), row.get("user_id"), channel, identity)
                if identity and key in seen:
                    continue
                if identity:
                    seen.add(key)
                accepted.append((stamp, candidate))
        count = len(accepted)
        successes = sum(row["success"] for _, row in accepted)
        # Failed timeouts are retained when their measured duration is known.
        latencies = [value for _, row in accepted
                     if (value := _number(row.get("latency_ms"))) is not None]
        ttfts = [value for _, row in accepted
                 if (value := _number(row.get("ttft_ms"))) is not None]
        interval = None
        if count:
            p = successes / count
            z = 1.959963984540054
            denominator = 1 + z * z / count
            centre = (p + z * z / (2 * count)) / denominator
            spread = z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
            interval = {"lower": max(0.0, centre - spread), "upper": min(1.0, centre + spread)}
        return {
            "status": "unmeasured" if not count else (
                "insufficient_samples" if count < self.minimum_samples else "measured"),
            "sample_count": count, "minimum_samples": self.minimum_samples,
            "success_count": successes, "failure_count": count - successes,
            "success_rate": successes / count if count else None,
            "success_rate_ci95": interval,
            "latency_sample_count": len(latencies), "p50_latency_ms": _quantile(latencies, .5),
            "p95_latency_ms": _quantile(latencies, .95),
            "ttft_sample_count": len(ttfts), "ttft_ms": _quantile(ttfts, .5),
            "observed_at": _iso(max(stamp for stamp, _ in accepted)) if accepted else None,
            "window_start": _iso(lower), "window_end": _iso(now),
            "window_hours": self.window_hours,
            "latency_scope": "channel_attempt_when_available_legacy_final_request_otherwise",
            "observation_unit": "executed_channel_attempt_or_legacy_final_outcome",
            "evidence_note": "Real completed channel attempts; legacy final request outcomes are used only when no attempt trace exists. Request mix may differ across providers.",
        }

    def _requirements(self, request: Mapping[str, Any]) -> dict[str, Any]:
        requirements = request.get("requirements", {})
        if not isinstance(requirements, dict):
            raise ProviderDecisionError("requirements must be an object")
        allowed = {"stream", "tool_calling", "context_tokens", "sensitive", "allowed_regions",
                   "require_no_training", "max_retention_days"}
        if set(requirements) - allowed:
            raise ProviderDecisionError("unknown request requirement")
        result = {"stream": False, "tool_calling": False, "context_tokens": 0,
                  "sensitive": False, "allowed_regions": [], "require_no_training": False,
                  "max_retention_days": None, **requirements}
        for key in ("stream", "tool_calling", "sensitive", "require_no_training"):
            if not isinstance(result[key], bool):
                raise ProviderDecisionError(f"{key} must be boolean")
        for key in ("context_tokens", "max_retention_days"):
            value = result[key]
            if key == "max_retention_days" and value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ProviderDecisionError(f"{key} must be a non-negative integer")
        regions = result["allowed_regions"]
        if not isinstance(regions, list) or any(not isinstance(item, str) or not item for item in regions):
            raise ProviderDecisionError("allowed_regions must be a list of region identifiers")
        result["allowed_regions"] = sorted(set(regions))
        return result

    def _exclusions(self, offer: dict[str, Any], requirements: dict[str, Any],
                    objective: str, now: datetime) -> list[str]:
        reasons = []
        access = offer["access_policy"]
        strict = any(requirements[key] for key in (
            "stream", "tool_calling", "context_tokens", "sensitive", "allowed_regions", "require_no_training"))
        strict = strict or requirements["max_retention_days"] is not None
        if offer["quote_status"] != "documented_estimate":
            reasons.append("price_" + offer["quote_status"])
        if strict:
            verified = _parse_time(access["verified_at"])
            if access["verification_status"] not in {"verified", "account_verified", "contract_verified"}:
                reasons.append("access_policy_pending_confirmation")
            elif verified is None or verified > now:
                reasons.append("access_policy_invalid_verification_time")
            sources = access.get("source_urls")
            if not isinstance(sources, list) or not sources or any(
                not isinstance(source, str) or not source.startswith("https://") for source in sources):
                reasons.append("access_policy_missing_source_evidence")
        for key in ("stream", "tool_calling"):
            if requirements[key] and access[key] != "supported":
                reasons.append(key + "_" + access[key])
        if requirements["context_tokens"] and (access["max_context_tokens"] is None
                or requirements["context_tokens"] > access["max_context_tokens"]):
            reasons.append("context_limit_unknown_or_exceeded")
        regions = requirements["allowed_regions"]
        # Every configured storage region must satisfy the request, rather than
        # accepting a single allowed region alongside disallowed replication.
        if regions and (not access["storage_regions"] or not set(access["storage_regions"]).issubset(regions)):
            reasons.append("storage_region_unverified_or_disallowed")
        if requirements["sensitive"] and access["sensitive_tasks_allowed"] is not True:
            reasons.append("sensitive_task_not_approved")
        if requirements["require_no_training"] and access["training_use"] != "not_used":
            reasons.append("training_policy_unverified_or_disallowed")
        limit = requirements["max_retention_days"]
        if limit is not None and (access["retention_days"] is None or access["retention_days"] > limit):
            reasons.append("retention_policy_unverified_or_exceeded")
        health = offer["health"]
        if objective == "highest_reliability" and health["status"] != "measured":
            reasons.append("insufficient_reliability_evidence")
        if objective == "lowest_latency" and health["latency_sample_count"] < self.minimum_samples:
            reasons.append("insufficient_latency_evidence")
        return reasons

    def compare(self, request: dict[str, Any],
                observations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise ProviderDecisionError("request must be an object")
        model = request.get("model_id")
        if not isinstance(model, str) or not model:
            raise ProviderDecisionError("model_id is required")
        objective = request.get("objective", "balanced")
        if objective not in OBJECTIVES:
            raise ProviderDecisionError("unknown routing objective")
        requirements = self._requirements(request)
        manual = request.get("manual_channel_id")
        if manual is not None and (not isinstance(manual, str) or not manual):
            raise ProviderDecisionError("manual_channel_id must be a non-empty string or null")
        currency = request.get("currency")
        if currency is not None and (not isinstance(currency, str) or len(currency) != 3 or not currency.isupper()):
            raise ProviderDecisionError("currency must be a three-letter uppercase identifier")
        excluded_channels = request.get("excluded_channels", [])
        if not isinstance(excluded_channels, list) or any(
            not isinstance(item, str) or not item for item in excluded_channels):
            raise ProviderDecisionError("excluded_channels must be a list of channel identifiers")
        excluded_channels = sorted(set(excluded_channels))
        for key in ("project_id", "user_id"):
            if request.get(key) is not None and not isinstance(request[key], str):
                raise ProviderDecisionError(f"{key} must be a string or null")
        now = self._now()
        observation_time = now
        if request.get("observations_as_of") is not None:
            observation_time = _parse_time(request["observations_as_of"])
            if observation_time is None or observation_time > now:
                raise ProviderDecisionError("observations_as_of must be a past or current timezone-aware timestamp")
        result = compare_model_channels(model, request.get("input_tokens", 1000),
            request.get("output_tokens", 500), request.get("cached_input_tokens", 0),
            now=now, mapping=self.mapping, cost_catalog=self.cost_catalog)
        normalized = {"model_id": result["model_id"], "objective": objective,
            "input_tokens": request.get("input_tokens", 1000),
            "output_tokens": request.get("output_tokens", 500),
            "cached_input_tokens": request.get("cached_input_tokens", 0),
            "requirements": requirements, "manual_channel_id": manual,
            "currency": currency, "project_id": request.get("project_id"), "user_id": request.get("user_id"),
            "excluded_channels": excluded_channels,
            "observations_as_of": _iso(observation_time) if request.get("observations_as_of") is not None else None}
        fingerprint = hashlib.sha256(json.dumps(normalized, sort_keys=True,
            separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
        offers = result["offers"]
        for offer in offers:
            offer["access_policy"] = self._access(offer["channel_id"])
            offer["health"] = self._health(result["model_id"], offer["channel_id"], observations or [], observation_time)
            offer["identity"] = verify_model_identity(model, offer)
            reasons = self._exclusions(offer, requirements, objective, now)
            if offer["channel_id"] in excluded_channels:
                reasons.append("channel_excluded_by_request")
            if currency is not None and offer["currency"] != currency:
                reasons.append("currency_does_not_match_request")
            offer["exclusion_reasons"] = reasons
            offer["eligible"] = not reasons
            offer["score"] = None
            offer["score_breakdown"] = {}
        eligible = [offer for offer in offers if offer["eligible"]]
        currencies = {offer["currency"] for offer in eligible}
        ranking_block = None
        if len(currencies) > 1:
            ranking_block = "currency_conversion_required_select_currency"
        dimensions = ["cost"]
        if eligible and all(item["health"]["status"] == "measured" for item in eligible):
            dimensions.append("reliability")
        if eligible and all(item["health"]["latency_sample_count"] >= self.minimum_samples for item in eligible):
            dimensions.append("latency")
        if eligible and ranking_block is None:
            low_cost = min(Decimal(item["estimated_cost"]) for item in eligible)
            high_cost = max(Decimal(item["estimated_cost"]) for item in eligible)
            latencies = [item["health"]["p95_latency_ms"] for item in eligible] if "latency" in dimensions else []
            for offer in eligible:
                cost = Decimal(offer["estimated_cost"])
                parts = {"cost": 1.0 if low_cost == high_cost else float((high_cost - cost) / (high_cost - low_cost))}
                if "reliability" in dimensions:
                    parts["reliability"] = offer["health"]["success_rate"]
                if "latency" in dimensions:
                    latency = offer["health"]["p95_latency_ms"]
                    parts["latency"] = 1.0 if min(latencies) == max(latencies) else (
                        max(latencies) - latency) / (max(latencies) - min(latencies))
                weights = self.weights if objective == "balanced" else {
                    "cost": float(objective == "lowest_cost"),
                    "latency": float(objective == "lowest_latency"),
                    "reliability": float(objective == "highest_reliability")}
                weight_sum = sum(weights[key] for key in parts)
                if weight_sum == 0:
                    ranking_block = "no_comparable_scoring_dimensions"
                    break
                offer["score_breakdown"] = {key: {"score": value,
                    "weight": weights[key] / weight_sum} for key, value in parts.items()}
                offer["score"] = sum(value * weights[key] for key, value in parts.items()) / weight_sum
        ranked = sorted(eligible, key=lambda item: (
            -(item["score"] or 0), item["priority"], item["channel_id"]))
        selected = None
        reason = "No provider satisfies the requested capability, privacy, price freshness and evidence requirements."
        if manual is not None:
            selected = next((item for item in eligible if item["channel_id"] == manual), None)
            reason = "Manual selection passed all request and policy requirements." if selected else (
                "Manual selection was rejected by the same eligibility checks used for recommendations.")
        elif ranked and ranking_block is None:
            selected = ranked[0]
            reason = f"Highest {objective.replace('_', ' ')} score using comparable " + ", ".join(dimensions) + " evidence."
        elif ranking_block:
            reason = ("Prices use different currencies; select a currency before comparing them."
                      if ranking_block == "currency_conversion_required_select_currency" else
                      "Configured weights assign no value to the available shared evidence.")
        if selected and objective == "balanced" and len(dimensions) < 3:
            reason += " Insufficient shared observations; missing latency/reliability evidence does not count as zero or perfect performance."
        for offer in offers:
            difference = {"estimated_cost": None, "success_rate": None, "p95_latency_ms": None}
            if selected:
                if offer["estimated_cost"] is not None and offer["currency"] == selected["currency"]:
                    difference["estimated_cost"] = format(Decimal(offer["estimated_cost"]) - Decimal(selected["estimated_cost"]), "f")
                for key in ("success_rate", "p95_latency_ms"):
                    value, base = offer["health"][key], selected["health"][key]
                    enough = (offer["health"]["status"] == selected["health"]["status"] == "measured")
                    if key == "p95_latency_ms":
                        enough = enough and min(offer["health"]["latency_sample_count"],
                            selected["health"]["latency_sample_count"]) >= self.minimum_samples
                    if enough and value is not None and base is not None:
                        difference[key] = value - base
            offer["difference_vs_selected"] = difference
        return {**result, "quote_inputs": normalized, "request_fingerprint": fingerprint,
            "offers": offers, "selected_channel": selected["channel_id"] if selected else None,
            "recommendation": {"status": "recommended" if selected else "blocked",
                "objective": objective, "reason": reason,
                "manual_override": manual is not None,
                "score": selected["score"] if selected else None,
                "comparable_dimensions": dimensions,
                "ranking_block": ranking_block},
            "ranking": [item["channel_id"] for item in ranked] if ranking_block is None else [],
            "excluded": [{"channel_id": item["channel_id"], "reasons": item["exclusion_reasons"]}
                         for item in offers if not item["eligible"]],
            "network_called": False,
            "limitations": list(dict.fromkeys(result["limitations"] + [
                "Provider comparison does not establish account activation, quota or an execution approval.",
                "Reliability and latency use real local channel attempts (legacy final outcomes only without attempt traces) for the exact model and rolling window; request mix may differ.",
                "Published estimates are not invoices; currencies are never silently converted.",
            ]))}
