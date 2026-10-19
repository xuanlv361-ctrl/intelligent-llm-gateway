import copy
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import cost_aware_model_router as router  # noqa: E402
from task_classifier import build_task_profile  # noqa: E402

AS_OF = datetime(2026, 10, 19, tzinfo=timezone.utc)


def test_coding_quality_first_prefers_high_capability_model():
    profile = build_task_profile("Implement Python code and debug this function")
    result = router.select_model(profile, objective="quality_first", now=AS_OF)
    assert result["selected_model"] == "deepseek-v4.1-flash-1017"
    assert result["ranking"][0]["score_breakdown"]["capability_score"] >= 0.9


def test_simple_question_uses_real_prices_and_does_not_invent_latency():
    profile = build_task_profile("What is a transformer?")
    result = router.select_model(profile, objective="balanced", now=AS_OF)
    assert result["selected_model"] == "deepseek-v4.1-flash-1017"
    assert result["ranking"][0]["score_breakdown"]["cost_score"] > 0.9
    assert result["unavailable_components"] == ["latency"]
    assert result["effective_weights"]["latency"] == 0
    assert all(row["score_breakdown"]["latency_score"] is None for row in result["ranking"])
    assert result["ranking"][0]["input_price"] == "0.30"
    assert result["ranking"][0]["price_source_url"].startswith("https://api-docs.deepseek.com/")


def test_cost_first_policy_changes_coding_ranking():
    # A controlled trade-off checks policy behaviour independently of which
    # vendor happens to be cheapest in the current market snapshot.
    capability = {"models": [
        {"model_id": "quality", "capabilities": {"coding_score": 1.0}},
        {"model_id": "cheap", "capabilities": {"coding_score": 0.5}},
    ]}
    costs = {"models": [
        {"model_id": "quality", "input_price": 10, "output_price": 30,
         "currency": "USD", "cost_level": "high", "latency_level": None},
        {"model_id": "cheap", "input_price": 0.1, "output_price": 0.1,
         "currency": "USD", "cost_level": "low", "latency_level": None},
    ]}
    profile = {"requirements": {"coding": 1.0}}
    quality = router.select_model(profile, capability, costs, objective="quality_first")
    cost = router.select_model(profile, capability, costs, objective="cost_first")
    assert quality["selected_model"] == "quality"
    assert cost["selected_model"] == "cheap"


def test_output_is_deterministic_and_has_breakdowns():
    profile = build_task_profile("Summarize this long document")
    first = router.select_model(profile, now=AS_OF)
    assert first == router.select_model(profile, now=AS_OF)
    assert {
        "capability_score", "cost_score", "latency_score",
        "weighted_capability", "weighted_cost", "weighted_latency",
    } <= first["score_breakdown"].keys()
    assert first["source_type"] == "provider_published_list_prices"
    assert first["real_api_called"] is False


def test_catalog_and_policy_validation():
    cost_catalog = router.load_json(router.DEFAULT_COST_CATALOG)
    assert len(cost_catalog["models"]) == 6
    assert cost_catalog["price_unit"] == "currency_per_1m_tokens"
    policy = router.load_json(router.DEFAULT_POLICY)
    router.validate_policy(policy)
    invalid = copy.deepcopy(policy)
    invalid["objectives"]["balanced"]["weights"]["cost"] = 0.4
    try:
        router.validate_policy(invalid)
        assert False, "invalid weight sum should fail"
    except router.CostAwareModelError:
        pass


def test_stale_market_prices_cannot_drive_model_selection():
    import pytest
    with pytest.raises(router.CostAwareModelError, match="no current documented"):
        router.select_model({"requirements": {"coding": 1}},
                            now=datetime(2026, 11, 1, tzinfo=timezone.utc))


def test_gpt_legacy_preference_returns_a_concrete_priced_model():
    result = router.select_model({"requirements": {"agent": 1}},
                                 objective="quality_first", now=AS_OF)
    assert result["selected_model"] == "gpt-4.1-2025-04-14"
    assert result["selected_model_preference"] == "gpt-4o-4-1"


def test_demo_output_has_three_scenarios_and_no_api_calls():
    payload = router.build_demo(now=AS_OF)
    assert len(payload["scenarios"]) == 3
    assert payload["real_api_calls_performed"] == 0
    assert {row["scenario_id"] for row in payload["scenarios"]} == {
        "coding_request", "simple_question", "long_document_analysis"
    }


def test_cached_tokens_change_cost_ranking_using_the_request_quote():
    profile = {"requirements": {"reasoning": 1}, "input_tokens": 100000, "output_tokens": 0}
    normal = {row["model_preference"]: row for row in router.select_model(profile, now=AS_OF)["ranking"]}
    cached = {row["model_preference"]: row for row in router.select_model(
        {**profile, "cached_input_tokens": 100000}, now=AS_OF)["ranking"]}
    assert normal["qwen"]["score_breakdown"]["cost_score"] > normal["gemini-flash"]["score_breakdown"]["cost_score"]
    assert cached["qwen"]["score_breakdown"]["cost_score"] < cached["gemini-flash"]["score_breakdown"]["cost_score"]
    assert Decimal(cached["qwen"]["estimated_request_cost"]) == Decimal("0.008")
    assert Decimal(cached["gemini-flash"]["estimated_request_cost"]) == Decimal("0.0075")


def test_input_output_ratio_changes_the_actual_cost_component():
    profile = {"requirements": {"reasoning": 1}, "input_tokens": 1000, "output_tokens": 0}
    input_only = router.select_model(profile, now=AS_OF)
    output_heavy = router.select_model({**profile, "output_tokens": 10000}, now=AS_OF)
    first = next(row for row in input_only["ranking"] if row["model_preference"] == "qwen")
    second = next(row for row in output_heavy["ranking"] if row["model_preference"] == "qwen")
    assert first["score_breakdown"]["cost_score"] != second["score_breakdown"]["cost_score"]


def test_protected_core_is_unchanged():
    assert hashlib.sha256((ROOT / "src" / "strategy_engine.py").read_bytes()).hexdigest().upper() == \
        "1E6D5A1BC9B47D38C4E334FD1C7D698DFE49DC2C180D446079CF753430152AA0"
