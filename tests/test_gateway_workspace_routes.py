import asyncio
import ast
from datetime import datetime, timezone
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
import httpx
import pytest

from backend.gateway_workspace_routes import build_gateway_workspace_router
from backend.security.http import _permission_for

NOW = datetime(2026,10,19,12,tzinfo=timezone.utc)


def test_product_api_is_registered_before_spa_catch_all():
    # Importing the full production application would initialise unrelated
    # stores. Check registration order without altering application state.
    source = Path(__file__).resolve().parents[1] / "backend/app.py"
    statements = ast.parse(source.read_text(encoding="utf-8")).body
    api_registration = next(index for index, node in enumerate(statements)
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
        and "app.include_router(build_gateway_workspace_router(" in ast.unparse(node))
    spa_registration = next(index for index, node in enumerate(statements)
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
        and "app.add_api_route('/{frontend_path:path}'" in ast.unparse(node))
    assert api_registration < spa_registration


def client_app(tmp_path, *, permissions=None, adapters=None):
    principal = SimpleNamespace(tenant_id="test-tenant",workspace_id="workspace",principal_id="fixture-operator")
    allowed = permissions if permissions is not None else {"decision.read","scheduler.decide","scheduler.execute","tenant.manage","evidence.import"}
    def authorize(_principal,permission):
        if permission not in allowed:
            raise HTTPException(403,detail={"code":"permission_denied"})
    app = FastAPI()
    app.include_router(build_gateway_workspace_router(lambda:tmp_path/"gateway.sqlite3",lambda request:principal,authorize,
        adapter_provider=adapters,clock=lambda:NOW))
    return app


def call(app,method,url,**kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://fixture") as client:
            return await client.request(method,url,**kwargs)
    return asyncio.run(asyncio.wait_for(run(),timeout=15))


def profile(**extra):
    return {"project_id":"default","model_id":"deepseek-v4.1-flash-1017","input_tokens":10000,"output_tokens":2000,**extra}


def test_catalog_quotes_are_real_documents_without_inference(tmp_path):
    app=client_app(tmp_path)
    response=call(app,"GET","/api/v1/gateway/catalog")
    assert response.status_code==200,response.text
    assert response.json()["offer_count"]==8
    assert all(not row["ready"] for row in response.json()["execution_readiness"].values())
    quote=call(app,"POST","/api/v1/gateway/compare",json=profile())
    assert quote.status_code==200,quote.text
    assert len(quote.json()["offers"])==3
    assert quote.json()["budget_check"]["allowed"] is True
    assert quote.json()["budget_check"]["reserve_amount"]=="0.0054"
    assert call(app,"GET","/api/v1/gateway/records").json()["items"]==[]


def test_budget_blocks_quote_and_is_not_reset_by_read(tmp_path):
    app=client_app(tmp_path)
    saved=call(app,"PUT","/api/v1/gateway/budget",json={"project_id":"default","currency":"USD","daily_limit":"0.001","monthly_limit":"1"})
    assert saved.status_code==200,saved.text
    quote=call(app,"POST","/api/v1/gateway/compare",json=profile()).json()
    assert quote["budget_check"]["allowed"] is False
    assert "daily_budget_exceeded" in quote["budget_check"]["reasons"]
    assert call(app,"GET","/api/v1/gateway/budget").json()["daily_limit"]=="0.001"


def test_private_request_and_manual_override_apply_same_filters(tmp_path):
    app=client_app(tmp_path)
    quote=call(app,"POST","/api/v1/gateway/compare",json=profile(
        manual_channel_id="DEEPSEEK-DIRECT-FLASH",requirements={"sensitive":True,"allowed_regions":["UK"]})).json()
    assert quote["selected_channel"] is None
    assert quote["budget_check"]["allowed"] is False


def test_access_review_needs_permission_and_evidence(tmp_path):
    app=client_app(tmp_path)
    value={"stream":"supported","verification_status":"verified","evidence_reference":"fixture-contract"}
    response=call(app,"PUT","/api/v1/gateway/access-policy/DEEPSEEK-DIRECT-FLASH",json=value)
    assert response.status_code==400
    value["source_urls"]=["https://example.invalid/fixture-contract"]
    assert call(app,"PUT","/api/v1/gateway/access-policy/DEEPSEEK-DIRECT-FLASH",json=value).status_code==200
    protected=client_app(tmp_path,permissions={"decision.read"})
    assert call(protected,"PUT","/api/v1/gateway/access-policy/DEEPSEEK-DIRECT-FLASH",json=value).status_code==403


def test_evidence_references_cannot_store_credentials(tmp_path):
    app = client_app(tmp_path)
    response = call(app, "PUT", "/api/v1/gateway/access-policy/DEEPSEEK-DIRECT-FLASH",
        json={"evidence_reference": "api_key=not-a-real-credential"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "credential_in_evidence_rejected"
    settlement = call(app, "POST", "/api/v1/gateway/settlements/not-executed",
        json={"actual_cost": "0", "evidence_reference": "Authorization: Bearer fixture-secret"})
    assert settlement.status_code == 400
    assert "fixture-secret" not in settlement.text


def test_disabled_execution_produces_no_record_or_charge(tmp_path):
    app=client_app(tmp_path)
    result=call(app,"POST","/api/v1/gateway/execute",json={"request_id":"fixture-request","profile":profile(),
        "messages":[{"role":"user","content":"Hello"}],"explicit_confirmation":True})
    assert result.status_code==409,result.text
    assert call(app,"GET","/api/v1/gateway/records").json()["items"]==[]
    assert call(app,"GET","/api/v1/gateway/budget").json()["reserved"]=="0"


def test_analytics_replay_alerts_have_honest_empty_states(tmp_path):
    app=client_app(tmp_path)
    analytics=call(app,"GET","/api/v1/gateway/analytics").json()
    assert analytics["record_count"]==0 and analytics["currencies"]=={}
    replay=call(app,"POST","/api/v1/gateway/replay",json={"objective":"lowest_cost"}).json()
    assert replay["request_count"]==0 and replay["pricing_coverage"] is None
    assert call(app,"GET","/api/v1/gateway/alerts").status_code==200


def test_historical_health_and_identity_cannot_be_forged_in_compare_body(tmp_path):
    response=call(client_app(tmp_path),"POST","/api/v1/gateway/compare",json=profile(
        observations_as_of="2026-10-01T00:00:00Z",actual_model="fake"))
    assert response.status_code==422


class InjectedAdapter:
    """In-process fixture only: no sockets and no model invocation."""
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def readiness(self, offer):
        return {"ready": True, "enabled": True, "credential_configured": True}

    def validate(self, offer, payload):
        assert payload["explicit_confirmation"] is True

    def __call__(self, offer, payload, attempt_id):
        self.calls.append((offer["channel_id"], attempt_id))
        return {"is_mock": False, "network_called": False, "latency_ms": 12, "output_started": False,
                "actual_model": offer["provider_model_id"], **self.outcomes.pop(0)}


def execution_input(**extra):
    return {"request_id": "fixture-execute", "profile": profile(),
            "messages": [{"role": "user", "content": "Explain water circulation."}],
            "explicit_confirmation": True, **extra}


def test_execute_deduplicates_before_rechecking_consumed_budget(tmp_path):
    adapter = InjectedAdapter([{"success": True, "billing_state": "charged", "actual_cost": "0.0054",
                                "response_content": "Fixture-only response"}])
    app = client_app(tmp_path, adapters=lambda: adapter)
    call(app, "PUT", "/api/v1/gateway/budget", json={"daily_limit": "0.0054"})
    body = execution_input()
    first = call(app, "POST", "/api/v1/gateway/execute", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "success"
    assert first.json()["identity"]["verification_status"] == "self_reported_match"
    assert first.json()["response_content"] == "Fixture-only response"
    second = call(app, "POST", "/api/v1/gateway/execute", json=body)
    assert second.status_code == 200, second.text
    assert second.json()["deduplicated"] is True
    assert second.json()["response_content_retained"] is False
    assert "response_content" not in second.json()
    assert len(adapter.calls) == 1
    body["messages"][0]["content"] = "A different request."
    conflict = call(app, "POST", "/api/v1/gateway/execute", json=body)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_conflict"
    assert len(adapter.calls) == 1


def test_http_fallback_trace_and_uncertain_billing_stop(tmp_path):
    adapter = InjectedAdapter([
        {"success": False, "http_status": 503, "error_category": "temporary_server_error", "billing_state": "not_charged"},
        {"success": True, "billing_state": "unknown", "actual_cost": None},
    ])
    app = client_app(tmp_path, adapters=lambda: adapter)
    first = call(app, "POST", "/api/v1/gateway/execute", json=execution_input()).json()
    assert first["success"] is True
    assert len(first["attempts"]) == 2
    assert first["selected_channel"] != first["final_channel"]
    assert first["cost_status"] == "unknown" and first["actual_cost"] is None
    assert first["fallback_trace"][-1]["action"] == "final"
    assert call(app, "GET", "/api/v1/gateway/budget").json()["reserved"] == "0.0054"
    stopped = InjectedAdapter([
        {"success": False, "error_category": "timeout", "billing_state": "unknown"},
    ])
    stopped_app = client_app(tmp_path, adapters=lambda: stopped)
    response = call(stopped_app, "POST", "/api/v1/gateway/execute", json=execution_input(request_id="uncertain"))
    assert response.status_code == 200, response.text
    assert response.json()["stop_reason"] == "billing_uncertain"
    assert len(stopped.calls) == 1


@pytest.mark.parametrize("method,path,permission",[
    ("GET","/api/v1/gateway/catalog","decision.read"),
    ("POST","/api/v1/gateway/compare","scheduler.decide"),
    ("POST","/api/v1/gateway/execute","scheduler.execute"),
    ("PUT","/api/v1/gateway/budget","tenant.manage"),
    ("PUT","/api/v1/gateway/access-policy/channel","tenant.manage"),
    ("POST","/api/v1/gateway/settlements/request","evidence.import"),
])
def test_workspace_permissions_are_explicit(method,path,permission):
    assert _permission_for(method,path)==permission
