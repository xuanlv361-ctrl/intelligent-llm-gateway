"""Observed usage remains distinct from prices, simulations and counterfactuals."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from backend.gateway_insights_service import GatewayInsightsService


NOW = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)


def service(**policy):
    return GatewayInsightsService(policy=policy, clock=lambda: NOW)


def record(index=0, **changes):
    row = {"request_id": f"R-{index}", "project_id": "project-1", "user_id": "user-1",
           "model_id": "model-1", "currency": "USD", "occurred_at": (NOW - timedelta(hours=1, minutes=index)).isoformat(),
           "status": "success", "selected_channel": "A", "final_channel": "A",
           "estimated_cost": "0.30", "actual_cost": "0.20", "cost_status": "observed",
           "latency_ms": 100, "success": True, "is_mock": False,
           "attempts": [{"channel_id": "A", "success": True}], "fallback_trace": [],
           "identity": {}, "request_profile": {"input_tokens": 1000, "output_tokens": 100, "cached_input_tokens": 0}}
    row.update(changes)
    if "attempts" not in changes:
        row["attempts"] = [{"channel_id": row["final_channel"], "success": row["success"], "latency_ms": row["latency_ms"]}]
    return row


def test_empty_analysis_preserves_unknowns_and_utc_period():
    result = service().analyze([])
    assert result["currencies"] == {}
    assert result["record_count"] == 0
    assert result["period_start"] == "2026-10-01T00:00:00Z"
    assert service().replay([], {}, object())["pricing_coverage"] is None
    assert service().alerts([]) == []


def test_local_pre_dispatch_failure_is_not_provider_health_evidence():
    rows = [record(index, network_called=False, success=False, status="failed",
        attempts=[{"channel_id": "A", "success": False, "network_called": False}])
        for index in range(6)]
    usd = service().analyze(rows)["currencies"]["USD"]
    assert usd["executed_sample_count"] == 0
    assert usd["success_rate"] is None
    assert usd["average_latency_ms"] is None
    assert not any(alert["type"] == "success_rate_low" for alert in service().alerts(rows))


def test_decimal_totals_currency_separation_and_unknown_cost():
    rows = [record(1, actual_cost="0.1"), record(2, actual_cost="0.2"),
            record(3, actual_cost=None, status="in_progress", success=None),
            record(4, currency="GBP", actual_cost="1.10"),
            record(5, currency=None, actual_cost="100")]
    result = service().analyze(rows)
    usd = result["currencies"]["USD"]
    assert Decimal(usd["actual_cost"]) == Decimal("0.3")
    assert usd["actual_cost_known_count"] == 2
    assert usd["actual_cost_unknown_count"] == usd["unresolved_count"] == 1
    assert usd["actual_cost_coverage"] == 2 / 3
    assert usd["executed_sample_count"] == 2
    assert usd["success_rate"] == 1
    assert result["currencies"]["GBP"]["actual_cost"] == "1.10"
    assert result["unknown_currency_count"] == 1
    assert "actual_cost" not in result  # no mixed-currency grand total
    assert service().analyze([record(actual_cost=None)])["currencies"]["USD"]["actual_cost"] is None


def test_groups_filters_and_success_denominator():
    rows = [record(1), record(2, success=False, status="failed", final_channel="B", project_id="project-2"),
            record(3, status="blocked", success=None, latency_ms=None)]
    result = service().analyze(rows, period="week")
    usd = result["currencies"]["USD"]
    assert usd["success_rate"] == 0.5
    assert usd["failure_count"] == 1
    assert usd["request_count"] == 3
    assert usd["latency_sample_count"] == 2
    for key in ("by_model", "by_channel", "by_project", "by_user", "daily", "weekly", "monthly"):
        assert usd[key]
    assert len(usd["by_channel"]) == 2
    assert service().analyze(rows, filters={"channel_id": "B"})["record_count"] == 1
    assert service().analyze(rows, filters={"project_id": "project-1"})["record_count"] == 2


def test_mock_injected_future_and_naive_timestamps_excluded():
    rows = [record(), record(1, is_mock=True), record(2, is_mock="TRUE"),
            record(3, fault_injected=True), record(4, injected=True), record(5, is_injected=True),
            record(6, occurred_at=(NOW + timedelta(seconds=1)).isoformat()),
            record(7, occurred_at="2026-10-19T10:00:00"), record(8, occurred_at="bad"),
            record(9, source_type="simulation"), record(10, is_fault_injected=True),
            record(11, attempts=[{"is_fault_injected": True}])]
    before = deepcopy(rows)
    assert service().analyze(rows)["record_count"] == 1
    assert rows == before


def test_utc_calendar_boundaries_and_explicit_date_filter():
    rows = [record(1, occurred_at="2026-10-19T00:00:00Z"), record(2, occurred_at="2026-10-18T23:59:59Z"),
            record(3, occurred_at="2026-09-30T23:59:59Z")]
    assert service().analyze(rows, "day")["record_count"] == 1
    assert service().analyze(rows, "week")["period_start"] == "2026-10-19T00:00:00Z"
    result = service().analyze(rows, filters={"date_from": "2026-09-01T00:00:00Z", "date_to": "2026-10-01T00:00:00Z"})
    assert result["record_count"] == 1
    assert result["period_start"] == "2026-09-01T00:00:00Z"
    with pytest.raises(ValueError):
        service().analyze(rows, "year")
    with pytest.raises(ValueError):
        service().analyze(rows, filters={"date_from": "bad"})


def test_sla_requires_five_samples_and_reports_missing_coverage():
    low_sample = [record(i, success=False, status="failed") for i in range(4)]
    assert {item["type"] for item in service().alerts(low_sample)} == {"insufficient_observations"}
    alerts = service().alerts(low_sample + [record(4, success=False, status="failed", latency_ms=None)])
    assert "success_rate_below_threshold" in {item["type"] for item in alerts}
    assert "insufficient_latency_observations" in {item["type"] for item in alerts}
    warning = next(item for item in alerts if item["type"] == "success_rate_below_threshold")
    assert warning["sample_count"] == 5
    assert warning["success_rate"] == 0
    assert warning["notification_mode"] == "in_app_read_only"
    with pytest.raises(ValueError):
        service(minimum_samples=4)


def test_p95_absolute_relative_baseline_and_stable_alert_identity():
    baseline = [record(i, occurred_at=(NOW - timedelta(hours=30, minutes=i)).isoformat(), latency_ms=100) for i in range(5)]
    current = [record(i + 5, latency_ms=20000) for i in range(5)]
    first = service().alerts(baseline + current)
    types = {item["type"] for item in first}
    assert {"p95_latency_high", "p95_latency_increase"} <= types
    assert service().alerts(baseline + current) == first
    later = GatewayInsightsService(clock=lambda: NOW + timedelta(minutes=1)).alerts(baseline + current)
    assert [item["alert_id"] for item in first] == [item["alert_id"] for item in later]
    assert all(item["cooldown_seconds"] == 3600 for item in first)


def test_model_identity_offer_and_observed_quota_alerts():
    records = [record(identity={"verification_status": "mismatch"})]
    offers = [{"channel_id": "B", "model_id": "m", "availability_status": "retired", "is_mock": False}]
    quotas = [{"channel_id": "A", "remaining": "5", "limit": "100", "observed_at": NOW.isoformat()},
              {"channel_id": "B", "remaining": "0", "limit": "100"},
              {"channel_id": "C", "remaining": None, "limit": "100", "observed_at": NOW.isoformat()}]
    alerts = service().alerts(records, offers=offers, quotas=quotas)
    assert {"model_identity_mismatch", "model_offer_unavailable", "quota_low", "quota_unknown"} <= {item["type"] for item in alerts}
    assert not any(item["type"] == "quota_low" and item["channel_id"] == "B" for item in alerts)


def price(**changes):
    row = {"model_id": "model-1", "channel_id": "A", "currency": "USD",
           "billing_unit": "currency_per_1m_tokens", "tier": {"context_max": 10000},
           "input_price": "1", "output_price": "2", "effective_from": "2026-10-01T00:00:00Z",
           "verified_at": "2026-10-18T00:00:00Z", "verification_status": "provider_documented", "is_mock": False}
    row.update(changes)
    return row


def test_price_alerts_compare_only_identical_currency_unit_model_and_tier():
    previous = [price(effective_until="2026-10-18T00:00:00Z")]
    current = [price(input_price="2", effective_from="2026-10-18T00:00:00Z")]
    alerts = service().alerts([], previous_prices=previous, current_prices=current)
    assert len(alerts) == 1
    assert alerts[0]["price_field"] == "input_price"
    assert alerts[0]["relative_change"] == "1"
    for changed in ({"currency": "GBP"}, {"billing_unit": "per_request"}, {"model_id": "other"},
                    {"tier": {"context_max": 20000}}, {"verified_at": "2027-01-01T00:00:00Z"},
                    {"effective_from": "2027-01-01T00:00:00Z"}, {"verification_status": "assumed"}):
        assert service().alerts([], previous_prices=[price()], current_prices=[price(input_price="2", **changed)]) == []


class Provider:
    def __init__(self):
        self.calls = []

    def compare(self, request, observations):
        self.calls.append(deepcopy((request, observations)))
        return {"selected_channel": "B", "currency": "USD", "offers": [
            {"channel_id": "A", "estimated_cost": "0.3", "currency": "USD"},
            {"channel_id": "B", "estimated_cost": "0.1", "currency": "USD"}],
            "recommendation": {"reason": "Lower documented cost"}}


def test_replay_strict_past_evidence_and_current_pricing_no_outcome_claims():
    old = record(1, occurred_at="2026-10-18T10:00:00Z")
    target = record(2, occurred_at="2026-10-19T10:00:00Z", actual_cost=None)
    simultaneous = record(3, occurred_at=target["occurred_at"])
    later = record(4, occurred_at="2026-10-19T11:00:00Z")
    records = [old, target, simultaneous, later, record(5, is_mock=True)]
    original = deepcopy(records)
    provider = Provider()
    result = service().replay(records, {"objective": "lowest_cost", "excluded_channels": ["C"]}, provider)
    assert provider.calls[0][1] == []
    assert [item["request_id"] for item in provider.calls[1][1]] == ["R-1"]
    assert [item["request_id"] for item in provider.calls[2][1]] == ["R-1"]
    assert provider.calls[1][0]["observations_as_of"] == target["occurred_at"]
    assert provider.calls[1][0]["excluded_channels"] == ["C"]
    assert result["request_count"] == result["priced_count"] == 4
    assert result["channel_change_count"] == 4
    assert Decimal(result["estimated_savings_by_currency"]["USD"]["estimated_savings"]) == Decimal("0.8")
    assert result["rows"][1]["actual_baseline_cost"] is None
    assert result["scenario_price_basis"] == "current_documented_price"
    assert result["execution_outcome_counterfactual"] == "unknown"
    assert all(row["historical_price_available"] is False for row in result["rows"])
    assert records == original
    assert service().replay(records, {"objective": "lowest_cost", "excluded_channels": ["C"]}, Provider()) == result


def test_replay_missing_tokens_and_cross_currency_never_estimates_fake_savings():
    provider = Provider()
    records = [record(1, request_profile={}), record(2, currency="GBP")]
    result = service().replay(records, {}, provider)
    assert len(provider.calls) == 1
    assert result["priced_count"] == 0
    assert result["estimated_savings_by_currency"] == {}
    assert all(row["comparable_estimated_savings"] is None for row in result["rows"])


def test_invalid_numbers_remain_unknown_and_inputs_unmodified():
    records = [record(actual_cost="NaN", estimated_cost={}, latency_ms="Infinity")]
    result = service().analyze(records)["currencies"]["USD"]
    assert result["actual_cost"] is result["estimated_cost"] is result["average_latency_ms"] is None
    assert result["actual_cost_unknown_count"] == 1


def test_partial_charge_is_not_presented_as_a_complete_bill():
    records = [record(1, actual_cost="0.05", cost_status="unknown"), record(2, actual_cost="0.1", cost_status="settled"),
               record(3, actual_cost="0", cost_status="not_charged"),
               record(4, actual_cost="0", cost_status="reserved", status="in_progress", success=None)]
    usd = service().analyze(records)["currencies"]["USD"]
    assert usd["actual_cost"] == "0.1"
    assert usd["actual_cost_known_count"] == usd["actual_cost_unknown_count"] == 2
    assert usd["unsettled_known_cost_subtotal"] == "0.05"
    assert usd["actual_cost_coverage"] == 0.5
    replay = service().replay(records[:1], {}, Provider())
    assert replay["rows"][0]["actual_baseline_cost"] is None


def test_distinct_price_tiers_produce_distinct_alerts():
    previous = [price(tier={"context_max": limit}) for limit in (1000, 10000)]
    current = [price(tier={"context_max": limit}, input_price="2") for limit in (1000, 10000)]
    alerts = service().alerts([], previous_prices=previous, current_prices=current)
    assert len(alerts) == 2
    assert len({item["fingerprint"] for item in alerts}) == 2


def test_channel_sla_uses_attempts_so_fallback_does_not_hide_primary_failures():
    records = [record(index, final_channel="B", attempts=[
        {"channel_id": "A", "success": False, "latency_ms": 500},
        {"channel_id": "B", "success": True, "latency_ms": 100}]) for index in range(5)]
    alerts = service().alerts(records)
    failures = [item for item in alerts if item["type"] == "success_rate_below_threshold"]
    assert len(failures) == 1
    assert failures[0]["channel_id"] == "A"
    assert failures[0]["sample_count"] == 5
    assert failures[0]["success_rate"] == 0
    # End-to-end request success still correctly counts the recovered result.
    assert service().analyze(records)["currencies"]["USD"]["success_rate"] == 1


def test_circuit_skip_is_not_an_observed_provider_failure():
    skipped = record(success=False, status="failed", attempts=[], stop_reason="no_available_channel", latency_ms=None)
    assert service().analyze([skipped])["currencies"]["USD"]["executed_sample_count"] == 0
    assert service().alerts([skipped]) == []


def test_replay_excludes_outcomes_not_completed_before_target_request():
    provider = Provider()
    started = record(1, occurred_at="2026-10-19T09:59:00Z", completed_at="2026-10-19T10:01:00Z")
    target = record(2, occurred_at="2026-10-19T10:00:00Z")
    service().replay([started, target], {}, provider)
    assert provider.calls[1][1] == []


def test_money_aggregates_do_not_round_at_default_decimal_precision():
    amount = "12345678901234567890123456789.123456789"
    result = service().analyze([record(1, actual_cost=amount), record(2, actual_cost=amount)])["currencies"]["USD"]
    assert result["actual_cost"] == "24691357802469135780246913578.246913578"
    assert result["actual_minus_estimated"] == "24691357802469135780246913577.646913578"


def test_no_network_imports():
    import ast
    from pathlib import Path
    tree = ast.parse((Path(__file__).resolve().parents[1] / "backend/gateway_insights_service.py").read_text(encoding="utf-8"))
    modules = [node.module if isinstance(node, ast.ImportFrom) else alias.name
               for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))
               for alias in (node.names if isinstance(node, ast.Import) else [None])]
    assert not any(name and name.split(".")[0] in {"requests", "httpx", "urllib", "socket"} for name in modules)
