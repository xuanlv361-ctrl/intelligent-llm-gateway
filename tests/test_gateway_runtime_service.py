"""Budget and recovery invariants without any real provider calls."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import sqlite3
from threading import Event

import pytest

from backend.gateway_runtime_service import GatewayRuntimeError, GatewayRuntimeService
from backend.tenant_security import TenantScope


@pytest.fixture
def runtime(tmp_path):
    return GatewayRuntimeService(tmp_path / "gateway.sqlite", TenantScope("tenant", "workspace"),
                                 lambda: datetime(2026, 10, 19, 12, tzinfo=timezone.utc))


def outcome(**overrides):
    result = {"success": True, "billing_state": "charged", "actual_cost": "0.2",
              "output_started": False, "is_mock": True, "actual_model": "deepseek",
              "http_status": 200, "latency_ms": 15, "input_tokens": 5, "output_tokens": 6}
    result.update(overrides)
    return result


OFFERS = [{"channel_id": "channel19", "provider_model_id": "deepseek"},
          {"channel_id": "channel48", "provider_model_id": "deepseek"},
          {"channel_id": "channel45", "provider_model_id": "deepseek"}]
PAYLOAD = {"model_id": "deepseek", "user_id": "user1", "messages": [{"content": "private prompt"}]}


def run(runtime, executor, **kwargs):
    defaults = dict(request_id="request1", project_id="project", currency="USD", reserve_amount="0.5",
                    payload=PAYLOAD, channel_order=OFFERS, executor=executor)
    defaults.update(kwargs)
    return runtime.execute(**defaults)


def test_exact_budget_enforces_both_limits_and_update_preserves_usage(runtime):
    runtime.set_budget("project", "USD", "0.3", "0.4")
    runtime.reserve("r1", "project", "USD", "0.1", "digest1")
    runtime.reserve("r2", "project", "USD", "0.2", "digest2")
    assert runtime.budget_status("project", "USD")["daily_remaining"] == "0.0"
    with pytest.raises(GatewayRuntimeError, match="daily_budget_exceeded"):
        runtime.reserve("r3", "project", "USD", "0.01", "digest3")
    runtime.set_budget("project", "USD", "1", "0.3")
    with pytest.raises(GatewayRuntimeError, match="monthly_budget_exceeded"):
        runtime.reserve("r3", "project", "USD", "0.01", "digest3")
    assert runtime.budget_status("project", "USD")["reserved"] == "0.3"


def test_concurrent_reservations_do_not_overspend(runtime):
    runtime.set_budget("project", "USD", "1", "1")
    def reserve(index):
        try:
            runtime.reserve(f"r{index}", "project", "USD", "0.2", str(index))
            return True
        except GatewayRuntimeError:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(20))) == 5
    assert runtime.budget_status("project", "USD")["reserved"] == "1.0"


def test_reservation_idempotency_restart_conflict_and_scope(runtime):
    first = runtime.reserve("r1", "project", "USD", "0.2", "same")
    restarted = GatewayRuntimeService(runtime.path, runtime.scope, runtime.clock)
    assert restarted.reserve("r1", "project", "USD", "0.2", "same") == first
    with pytest.raises(GatewayRuntimeError) as error:
        restarted.reserve("r1", "project", "USD", "0.2", "different")
    assert error.value.code == "idempotency_conflict"
    other = GatewayRuntimeService(runtime.path, TenantScope("another", "workspace"), runtime.clock)
    assert other.budget_status("project", "USD")["reserved"] == "0"
    other.reserve("r1", "project", "USD", "0.7", "different")
    assert restarted.budget_status("project", "USD")["reserved"] == "0.2"


def test_unresolved_reservations_continue_across_day_and_month(runtime):
    now = [datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc)]
    runtime.clock = lambda: now[0]
    runtime.set_budget("project", "USD", "1", "1")
    runtime.reserve("r1", "project", "USD", "0.8", "one")
    runtime.settle("r1")
    now[0] = datetime(2026, 11, 1, 0, 1, tzinfo=timezone.utc)
    status = runtime.budget_status("project", "USD")
    assert status["daily_remaining"] == status["monthly_remaining"] == "0.2"
    with pytest.raises(GatewayRuntimeError, match="budget_exceeded"):
        runtime.reserve("r2", "project", "USD", "0.3", "two")
    with pytest.raises(GatewayRuntimeError, match="reconciliation"):
        runtime.release("r1")
    runtime.settle("r1", "0.9")
    assert runtime.budget_status("project", "USD")["reserved"] == "0"


def test_settlement_cost_above_reserve_is_accounted_not_discarded(runtime):
    runtime.set_budget("project", "USD", "0.5", "1")
    runtime.reserve("r1", "project", "USD", "0.3", "digest")
    settled = runtime.settle("r1", "0.7")
    assert settled["budget_overrun"]
    status = runtime.budget_status("project", "USD")
    assert status["daily_spent"] == "0.7"
    assert status["daily_remaining"] == "-0.2"
    assert status["reserved"] == "0"
    assert runtime.release("r1")["status"] == "settled"


def test_release_frees_unattempted_capacity(runtime):
    runtime.reserve("r1", "project", "USD", "0.3", "digest")
    assert runtime.release("r1")["status"] == "released"
    assert runtime.budget_status("project", "USD")["reserved"] == "0"


def test_execution_persisted_idempotency_and_full_payload_conflict(runtime):
    calls = []
    def adapter(offer, payload, attempt):
        calls.append(attempt)
        return outcome()
    first = run(runtime, adapter)
    restarted = GatewayRuntimeService(runtime.path, runtime.scope, runtime.clock)
    assert run(restarted, adapter) == first
    assert len(calls) == 1
    for change in ({"payload": {**PAYLOAD, "messages": [{"content": "changed"}]}},
                   {"channel_order": list(reversed(OFFERS))}, {"reserve_amount": "0.6"}):
        with pytest.raises(GatewayRuntimeError, match="idempotency_conflict"):
            run(restarted, adapter, **change)
    assert first["identity"]["verification_status"] == "matched"
    assert first["final_channel"] == "channel19"
    assert restarted.list_records() == []
    assert restarted.list_records(include_mock=True) == [first]
    with sqlite3.connect(runtime.path) as db:
        stored = db.execute("SELECT record_json FROM gateway_reservations_v1").fetchone()[0]
    assert "private prompt" not in stored
    assert "messages" not in stored


def test_durable_inflight_claim_prevents_concurrent_and_restart_redispatch(runtime):
    started, finish = Event(), Event()
    calls = []
    def adapter(*_):
        calls.append(1)
        started.set()
        assert finish.wait(10)
        return outcome()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, runtime, adapter)
        assert started.wait(5)
        restarted = GatewayRuntimeService(runtime.path, runtime.scope, runtime.clock)
        duplicate = run(restarted, adapter)
        assert duplicate["status"] == "in_progress"
        assert duplicate["attempts"][0]["status"] == "in_progress"
        with pytest.raises(GatewayRuntimeError, match="reconciliation"):
            restarted.release("request1")
        finish.set()
        assert first.result()["success"] is True
    assert len(calls) == 1


def test_fallback_order_circuit_skip_complete_trace_and_unique_attempts(runtime):
    calls = []
    def adapter(offer, payload, attempt):
        calls.append((offer["channel_id"], attempt))
        return outcome(success=False, billing_state="not_charged", actual_cost=None,
                       http_status=503, error_category="temporary_server_error") if len(calls) == 1 else outcome()
    record = run(runtime, adapter, circuit_is_open=lambda channel: channel == "channel19")
    assert [channel for channel, _ in calls] == ["channel48", "channel45"]
    assert len({attempt for _, attempt in calls}) == 2
    assert record["final_channel"] == "channel45"
    assert record["actual_cost"] == "0.2"
    assert record["fallback_trace"][0]["reason"] == "circuit_open"
    assert record["fallback_trace"][-1]["action"] == "final"


@pytest.mark.parametrize("override", [
    {"http_status": 400, "error_category": "invalid_request"},
    {"http_status": 401, "error_category": "authentication_failure"},
    {"http_status": 503, "error_category": "invalid_parameters"},
    {"http_status": 503, "output_started": True},
    {"error_category": "timeout", "billing_state": "unknown", "http_status": None},
    {"error_category": "timeout", "billing_state": "charged", "actual_cost": "0.1"},
])
def test_non_retry_errors_output_and_uncertain_billing_stop(runtime, override):
    calls = []
    def adapter(*_):
        calls.append(1)
        return outcome(**{**dict(success=False, billing_state="not_charged", actual_cost=None,
                                 http_status=503, error_category="temporary_server_error"), **override})
    record = run(runtime, adapter)
    assert len(calls) == 1
    assert not record["success"]
    if override.get("billing_state") == "unknown":
        assert record["cost_status"] == "unknown"
        assert runtime.budget_status("project", "USD")["reserved"] == "0.5"
    if override.get("actual_cost"):
        assert runtime.budget_status("project", "USD")["daily_spent"] == "0.1"


def test_max_attempts_counts_dispatches(runtime):
    calls = []
    def adapter(*_):
        calls.append(1)
        return outcome(success=False, billing_state="not_charged", actual_cost=None, error_category="timeout")
    record = run(runtime, adapter, max_attempts=2)
    assert len(calls) == len(record["attempts"]) == 2
    assert not record["success"]


def test_unknown_success_cost_reserved_then_reconciled_in_records(runtime):
    record = run(runtime, lambda *_: outcome(actual_cost=None, billing_state="unknown"))
    assert record["success"] and record["cost_status"] == "unknown"
    assert runtime.budget_status("project", "USD")["reserved"] == "0.5"
    runtime.settle("request1", "0.15")
    assert runtime.list_records(include_mock=True)[0]["actual_cost"] == "0.15"
    assert runtime.budget_status("project", "USD")["daily_spent"] == "0.15"


def test_executor_exception_stops_and_secret_output_not_retained(runtime):
    def broken(*_):
        raise RuntimeError("api_key=SUPERSECRET")
    record = run(runtime, broken)
    assert len(record["attempts"]) == 1
    assert record["cost_status"] == "unknown"
    assert "SUPERSECRET" not in json.dumps(record)
    assert record["attempts"][0]["error_category"] == "executor_exception"


def test_metadata_redaction_and_model_mismatch(runtime):
    record = run(runtime, lambda *_: outcome(actual_model="other", billed_model="api_key=TOPSECRET"))
    assert record["identity"]["verification_status"] == "mismatch"
    assert "TOPSECRET" not in json.dumps(record)


def test_numeric_replay_profile_and_actual_usage_without_prompt_retention(runtime):
    payload = {**PAYLOAD, "input_tokens": 1000, "output_tokens": 500, "cached_input_tokens": 100,
               "requirements": {"stream": True, "min_context_tokens": 2000,
                                "data_region": "EU", "api_key": "SECRET", "prompt": "never store"}}
    record = run(runtime, lambda *_: outcome(network_called=True, is_mock=False,
                 cached_input_tokens=2), payload=payload)
    assert record["request_profile"] == {"input_tokens": 1000, "output_tokens": 500,
        "cached_input_tokens": 100, "requirements": {"stream": True, "min_context_tokens": 2000, "data_region": "EU"}}
    assert record["input_tokens"] == 5 and record["output_tokens"] == 6
    assert record["cached_input_tokens"] == 2
    assert record["network_called"] is True
    assert runtime.get_record("request1") == record
    assert runtime.list_records() == [record]
    assert "never store" not in json.dumps(record)


def test_replay_retains_privacy_contract_and_completion_timestamp(runtime):
    requirements = {"stream": True, "tool_calling": False, "context_tokens": 12000,
                    "sensitive": True, "allowed_regions": ["EU", "UK"], "require_no_training": True}
    result = run(runtime, lambda *_: outcome(), payload={**PAYLOAD, "requirements": requirements})
    assert result["request_profile"]["requirements"] == requirements
    assert result["completed_at"] == "2026-10-19T12:00:00Z"
    assert runtime.get_record("request1")["request_profile"]["requirements"] == requirements


@pytest.mark.parametrize("regions", [["EU"] * 21, ["api_key=SECRET"], "EU"])
def test_invalid_region_lists_cannot_be_retained_as_valid_replay_policy(runtime, regions):
    calls = []
    with pytest.raises(GatewayRuntimeError, match="invalid_replay_requirements"):
        run(runtime, lambda *_: calls.append(1), payload={**PAYLOAD, "requirements": {"allowed_regions": regions}})
    assert not calls
    assert runtime.get_record("request1") is None


def test_approved_checkpoint_uses_injected_identity_verifier(runtime):
    def verifier(requested_model, offer, actual_model=None, billed_model=None, observed_at=None):
        assert offer["provider_model_id"] == "deepseek"
        assert actual_model == "deepseek-checkpoint"
        return {"requested_model": requested_model, "provider_model_alias": "deepseek",
                "actual_returned_model": actual_model, "billed_model": billed_model,
                "verification_status": "self_reported_match", "last_verified_at": observed_at,
                "evidence_note": "Alias self-report only", "prompt": "must not persist"}
    record = run(runtime, lambda *_: outcome(actual_model="deepseek-checkpoint"), identity_verifier=verifier)
    assert record["identity"]["verification_status"] == "self_reported_match"
    assert record["identity"]["actual_returned_model"] == "deepseek-checkpoint"
    assert "prompt" not in record["identity"]


def test_attempt_ids_are_scoped_across_tenants(runtime):
    first = run(runtime, lambda *_: outcome())
    other = GatewayRuntimeService(runtime.path, TenantScope("another", "workspace"), runtime.clock)
    second = run(other, lambda *_: outcome())
    assert first["attempts"][0]["attempt_id"] != second["attempts"][0]["attempt_id"]


def test_request_input_hash_persisted_for_early_http_deduplication(runtime):
    payload = {**PAYLOAD, "request_input_hash": "AB" * 32}
    record = run(runtime, lambda *_: outcome(), payload=payload)
    assert record["request_input_hash"] == "ab" * 32
    assert runtime.get_record("request1")["request_input_hash"] == "ab" * 32


@pytest.mark.parametrize("value", ["not-a-hash", "a" * 63, "g" * 64, 123])
def test_request_input_hash_validation_prevents_dispatch(runtime, value):
    calls = []
    with pytest.raises(GatewayRuntimeError, match="invalid_request_input_hash"):
        run(runtime, lambda *_: calls.append(1), payload={**PAYLOAD, "request_input_hash": value})
    assert not calls


def test_partial_confirmed_cost_keeps_full_conservative_hold(runtime):
    record = run(runtime, lambda *_: outcome(success=False, billing_state="unknown", actual_cost="0.1"))
    status = runtime.budget_status("project", "USD")
    assert record["actual_cost"] == status["daily_spent"] == "0.1"
    assert status["reserved"] == "0.5"
    assert status["reservation_accounting"] == "confirmed_cost_plus_full_unresolved_reservation"
    runtime.settle("request1", "0.15")
    status = runtime.budget_status("project", "USD")
    assert status["daily_spent"] == "0.15"
    assert status["reserved"] == "0"


@pytest.mark.parametrize("amount", ["-1", "NaN", "Infinity", 1.2, True, "1e2"])
def test_invalid_amounts_rejected(runtime, amount):
    with pytest.raises(GatewayRuntimeError):
        runtime.reserve("r", "project", "USD", amount, "digest")


def test_explicit_tenant_scope_required(tmp_path):
    with pytest.raises(GatewayRuntimeError, match="tenant_scope_required"):
        GatewayRuntimeService(tmp_path / "db", None)
