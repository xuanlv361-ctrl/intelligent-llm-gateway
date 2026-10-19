"""Documented prices, measured evidence, hard policy filters and identity."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path

import pytest

from backend.provider_decision_service import (
    ProviderDecisionError, ProviderDecisionService, verify_model_identity,
)
from src.model_market_catalog import load_cost_catalog, load_mapping


NOW = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)
MODEL = "deepseek-v4.1-flash-1017"
DIRECT = "DEEPSEEK-DIRECT-FLASH"
TOGETHER = "TOGETHER-DEEPSEEK-V4.1-FLASH-1017"
FIREWORKS = "FIREWORKS-DEEPSEEK-V4.1-FLASH-1017"


@pytest.fixture
def catalogs():
    return load_mapping(), load_cost_catalog()


def service(catalogs=None, access_policy=None, now=NOW):
    mapping, costs = catalogs or (load_mapping(), load_cost_catalog())
    return ProviderDecisionService(mapping=mapping, cost_catalog=costs,
                                  access_policy=access_policy, clock=lambda: now)


def request(**kwargs):
    return {"model_id": MODEL, "input_tokens": 10000, "output_tokens": 2000, **kwargs}


def observation(channel=DIRECT, **kwargs):
    return {"model_id": MODEL, "final_channel": channel, "is_mock": False,
            "occurred_at": "2026-10-19T11:00:00Z", "success": True,
            "status": "success", "latency_ms": 100, **kwargs}


def confirmed_policy(channel=DIRECT, **kwargs):
    return {"channels": {channel: {
        "stream": "supported", "tool_calling": "supported", "max_context_tokens": 128000,
        "storage_regions": ["UK"], "retention_days": 0, "training_use": "not_used",
        "sensitive_tasks_allowed": True, "verification_status": "account_verified",
        "verified_at": "2026-10-19T00:00:00Z", "source_urls": ["https://example.test/contract"],
        **kwargs,
    }}}


def test_three_documented_deepseek_offers_have_actual_quotes_without_invented_health():
    result = service().compare(request())
    assert len(result["offers"]) == 3
    assert {Decimal(row["estimated_cost"]) for row in result["offers"]} == {Decimal("0.0054")}
    assert result["selected_channel"] == DIRECT
    assert result["recommendation"]["comparable_dimensions"] == ["cost"]
    assert result["recommendation"]["status"] == "recommended"
    for offer in result["offers"]:
        assert offer["health"]["sample_count"] == 0
        assert offer["health"]["success_rate"] is None
        assert offer["identity"]["actual_returned_model"] is None
        assert offer["execution_enabled"] is False
    assert result["network_called"] is False


def test_catalog_reports_all_model_offers_and_default_unconfirmed_access():
    result = service().catalog()
    assert len(result["models"]) == 6
    assert result["offer_count"] == len(result["offers"]) == 8
    for row in result["offers"]:
        assert row["access_policy"]["verification_status"] == "pending_confirmation"
        assert row["access_policy"]["sensitive_tasks_allowed"] is False


def test_real_exact_model_recent_observations_are_only_health_inputs():
    valid = [observation(latency_ms=100 + index * 100, success=index < 4) for index in range(5)]
    invalid = [observation(is_mock=True), observation(is_mock="FALSE"),
        observation(model_id="deepseek-reasoner"), observation(final_channel=TOGETHER, model_id="other"),
        observation(occurred_at="2026-10-18T11:59:59Z"),
        observation(occurred_at="2026-10-19T12:00:01Z"), observation(occurred_at="invalid"),
        observation(success="true"), observation(status="blocked_capability"),
        observation(execution_attempted=False), observation(network_called=False),
        observation(completed_at="2026-10-19T12:00:01Z")]
    health = service().compare(request(), valid + invalid)["offers"][0]["health"]
    assert health["sample_count"] == 5
    assert health["success_rate"] == .8
    assert health["p50_latency_ms"] == 300
    assert health["p95_latency_ms"] == 480
    assert health["status"] == "measured"
    assert 0 <= health["success_rate_ci95"]["lower"] < .8 < health["success_rate_ci95"]["upper"] <= 1


def test_unknown_or_insufficient_evidence_blocks_reliability_and_latency_objectives():
    svc = service()
    for objective in ("highest_reliability", "lowest_latency"):
        result = svc.compare(request(objective=objective), [observation()] * 4)
        assert result["selected_channel"] is None
        assert result["recommendation"]["status"] == "blocked"
        assert result["offers"][0]["health"]["status"] == "insufficient_samples"


def test_balanced_does_not_reward_measured_or_unknown_channel_unfairly():
    result = service().compare(request(), [observation(success=True)] * 5)
    assert result["recommendation"]["comparable_dimensions"] == ["cost"]
    assert len({row["score"] for row in result["offers"]}) == 1
    assert result["offers"][1]["difference_vs_selected"]["success_rate"] is None


def test_reliability_and_latency_rank_using_available_evidence():
    records = ([observation(success=False, latency_ms=900)] * 5
        + [observation(TOGETHER, latency_ms=200)] * 5
        + [observation(FIREWORKS, latency_ms=300)] * 5)
    result = service().compare(request(objective="highest_reliability"), records)
    assert result["selected_channel"] == TOGETHER
    assert result["offers"][0]["difference_vs_selected"]["success_rate"] == -1
    result = service().compare(request(objective="lowest_latency"), records)
    assert result["selected_channel"] == TOGETHER
    assert result["offers"][0]["difference_vs_selected"]["p95_latency_ms"] == 700


def test_fallback_success_does_not_hide_failed_primary_and_empty_attempts_do_not_count():
    records = [observation(TOGETHER, success=True, latency_ms=9999, attempts=[
        {"channel_id": DIRECT, "success": False, "latency_ms": 900, "is_mock": False},
        {"channel_id": TOGETHER, "success": True, "latency_ms": 100, "is_mock": False},
    ])] * 5
    records.append(observation(DIRECT, success=False, attempts=[]))
    result = service().compare(request(), records)
    direct, together = result["offers"][:2]
    assert direct["health"]["sample_count"] == 5
    assert direct["health"]["success_rate"] == 0
    assert direct["health"]["p95_latency_ms"] == 900
    assert together["health"]["success_rate"] == 1
    assert together["health"]["p95_latency_ms"] == 100


def test_duplicate_trace_and_injected_or_mock_attempts_cannot_inflate_evidence():
    records = [observation(attempts=[{"attempt_id": "FIXTURE-ATT", "channel_id": DIRECT,
        "success": True, "latency_ms": 100, "is_mock": False}])] * 5
    records += [observation(is_fault_injected=True), observation(attempts=[{
        "channel_id": DIRECT, "success": True, "is_mock": True}]), observation(attempts=[{
        "channel_id": DIRECT, "success": True, "is_mock": False, "fault_injected": True}])]
    health = service().compare(request(), records)["offers"][0]["health"]
    assert health["sample_count"] == 1
    assert health["status"] == "insufficient_samples"


@pytest.mark.parametrize("requirement", [
    {"stream": True}, {"tool_calling": True}, {"context_tokens": 1000},
    {"sensitive": True}, {"allowed_regions": ["UK", "EU"]},
    {"require_no_training": True}, {"max_retention_days": 0},
])
def test_unconfirmed_capabilities_privacy_and_regions_block_even_manual_override(requirement):
    result = service().compare(request(requirements=requirement, manual_channel_id=DIRECT))
    assert result["selected_channel"] is None
    assert result["recommendation"]["status"] == "blocked"
    assert all("access_policy_pending_confirmation" in row["reasons"] for row in result["excluded"])


def test_confirmed_account_policy_allows_exact_requirements():
    svc = service(access_policy=confirmed_policy())
    result = svc.compare(request(requirements={"stream": True, "tool_calling": True,
        "context_tokens": 12000, "sensitive": True, "allowed_regions": ["UK", "EU"],
        "require_no_training": True, "max_retention_days": 0}))
    assert result["selected_channel"] == DIRECT
    assert len(result["excluded"]) == 2


def test_one_allowed_region_does_not_hide_disallowed_replication():
    policy = confirmed_policy(storage_regions=["UK", "US"])
    result = service(access_policy=policy).compare(request(requirements={"allowed_regions": ["UK", "EU"]}))
    assert result["selected_channel"] is None
    assert "storage_region_unverified_or_disallowed" in result["offers"][0]["exclusion_reasons"]


def test_unverified_or_future_account_configuration_cannot_claim_readiness():
    for overrides in ({"verification_status": "provider_documented"},
                      {"verified_at": None}, {"verified_at": "2026-10-20T00:00:00Z"}):
        result = service(access_policy=confirmed_policy(**overrides)).compare(request(requirements={"stream": True}))
        assert result["selected_channel"] is None


def test_confirmed_account_policy_requires_source_evidence():
    result = service(access_policy=confirmed_policy(source_urls=[])).compare(request(requirements={"stream": True}))
    assert result["selected_channel"] is None
    assert "access_policy_missing_source_evidence" in result["offers"][0]["exclusion_reasons"]


def test_replay_uses_past_health_window_but_current_documented_prices():
    records = [observation(occurred_at="2026-10-17T10:00:00Z")] * 5
    svc = service()
    assert svc.compare(request(objective="highest_reliability"), records)["selected_channel"] is None
    result = svc.compare(request(objective="highest_reliability", observations_as_of="2026-10-17T11:00:00Z"), records)
    assert result["selected_channel"] == DIRECT
    assert result["as_of"] == "2026-10-19T12:00:00Z"
    assert result["offers"][0]["quote_status"] == "documented_estimate"
    assert result["offers"][0]["health"]["window_end"] == "2026-10-17T11:00:00Z"
    with pytest.raises(ProviderDecisionError, match="observations_as_of"):
        svc.compare(request(observations_as_of="2026-10-20T00:00:00Z"))


def test_stale_price_cannot_be_manually_selected():
    result = service(now=NOW + timedelta(days=8)).compare(request(manual_channel_id=DIRECT))
    assert result["selected_channel"] is None
    assert result["offers"][0]["exclusion_reasons"] == ["price_stale"]


def test_manual_selection_can_override_score_but_not_hard_filters():
    result = service().compare(request(manual_channel_id=FIREWORKS))
    assert result["selected_channel"] == FIREWORKS
    assert result["recommendation"]["manual_override"] is True
    assert "passed all" in result["recommendation"]["reason"]
    assert service().compare(request(manual_channel_id="UNKNOWN"))["selected_channel"] is None


def test_replay_excluded_channels_are_respected_including_manual_selection():
    result = service().compare(request(excluded_channels=[DIRECT]))
    assert result["selected_channel"] == TOGETHER
    assert result["offers"][0]["exclusion_reasons"] == ["channel_excluded_by_request"]
    assert service().compare(request(excluded_channels=[DIRECT], manual_channel_id=DIRECT))["selected_channel"] is None


def test_mixed_currencies_never_compared_or_silently_converted(catalogs):
    for row in catalogs[1]["channel_prices"]:
        if row["channel_id"] == TOGETHER:
            row["currency"] = "GBP"
    result = service(catalogs).compare(request(objective="lowest_cost"))
    assert result["selected_channel"] is None
    assert result["recommendation"]["ranking_block"] == "currency_conversion_required_select_currency"
    assert result["ranking"] == []
    filtered = service(catalogs).compare(request(objective="lowest_cost", currency="GBP"))
    assert filtered["selected_channel"] == TOGETHER
    assert all(row["difference_vs_selected"]["estimated_cost"] is None
               for row in filtered["offers"] if row["currency"] == "USD")


def test_identity_leaves_unobserved_fields_empty_and_accepts_explicit_rolling_checkpoint():
    offer = service().compare(request())["offers"][0]
    empty = verify_model_identity(MODEL, offer)
    assert empty["verification_status"] == "pending_confirmation"
    assert empty["actual_returned_model"] is None
    assert empty["billed_model"] is None
    identity = verify_model_identity(MODEL, offer, "DeepSeek-V4.1-Flash-1017",
        "deepseek-flash", "2026-10-19T11:00:00Z")
    assert identity["verification_status"] == "self_reported_match"
    assert identity["last_verified_at"] == "2026-10-19T11:00:00Z"
    assert identity["requested_model"] == MODEL


@pytest.mark.parametrize("actual", ["DeepSeek-V4", "DeepSeek-V4.1-Flash-1020", "other/deepseek-flash"])
def test_identity_cannot_fuzzy_match_other_versions_or_namespaces(actual):
    offer = service().compare(request())["offers"][0]
    identity = verify_model_identity(MODEL, offer, actual_model=actual)
    assert identity["verification_status"] == "mismatch"
    assert identity["mismatch_reasons"] == ["actual_model_mismatch"]


def test_billed_model_mismatch_is_not_hidden_by_matching_actual_model():
    offer = service().compare(request())["offers"][1]
    identity = verify_model_identity(MODEL, offer, offer["provider_model_id"], "different-billed-model")
    assert identity["verification_status"] == "mismatch"
    assert identity["mismatch_reasons"] == ["billed_model_mismatch"]


def test_explicit_approved_alias_is_supported_without_fuzzy_matching():
    offer = service().compare(request())["offers"][1]
    offer["approved_returned_model_ids"] = ["provider-approved-checkpoint"]
    assert verify_model_identity(MODEL, offer, "provider-approved-checkpoint")["verification_status"] == "self_reported_match"


def test_deterministic_fingerprint_does_not_mutate_catalogs_or_requests(catalogs):
    original = deepcopy(catalogs)
    svc = service(catalogs)
    payload = request(requirements={"allowed_regions": []}, project_id="demo")
    before = deepcopy(payload)
    first = svc.compare(payload)
    assert first == svc.compare(payload)
    assert len(first["request_fingerprint"]) == 64
    assert first["request_fingerprint"] != svc.compare({**payload, "output_tokens": 2001})["request_fingerprint"]
    assert catalogs == original
    assert payload == before
    first["offers"][0]["access_policy"]["stream"] = "supported"
    assert svc.compare(payload)["offers"][0]["access_policy"]["stream"] == "unknown"


@pytest.mark.parametrize("changes", [
    {"requirements": {"stream": "true"}}, {"requirements": {"allowed_regions": "UK"}},
    {"requirements": {"context_tokens": True}}, {"requirements": {"unknown": 1}},
    {"manual_channel_id": ""}, {"objective": "magic"}, {"currency": "usd"},
])
def test_invalid_requests_rejected(changes):
    with pytest.raises(ProviderDecisionError):
        service().compare(request(**changes))


def test_module_has_no_network_or_execution_imports():
    import ast
    import backend.provider_decision_service as module
    tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
    imports = {name.name.split(".")[0] for node in ast.walk(tree)
               if isinstance(node, ast.Import) for name in node.names}
    imports |= {node.module.split(".")[0] for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom) and node.module}
    assert not imports & {"requests", "httpx", "urllib", "socket", "aiohttp"}
    json.dumps(service().compare(request()), allow_nan=False)
