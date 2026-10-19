"""Tenant-scoped product endpoints for provider selection and operational control."""
from __future__ import annotations

from copy import deepcopy
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Callable, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.gateway_insights_service import GatewayInsightsService
from backend.gateway_provider_adapter import GatewayProviderAdapter, GatewayAdapterError
from backend.gateway_runtime_service import GatewayRuntimeService, GatewayRuntimeError
from backend.provider_decision_service import ProviderDecisionService, verify_model_identity
from backend.security.redaction import contains_sensitive_data
from backend.tenant_security import TenantScope

ROOT = Path(__file__).resolve().parents[1]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Requirements(StrictModel):
    stream: bool = False
    tool_calling: bool = False
    context_tokens: int = Field(0, ge=0, le=2000000)
    sensitive: bool = False
    allowed_regions: list[str] = Field(default_factory=list, max_length=20)
    require_no_training: bool = False


class CompareInput(StrictModel):
    project_id: str = Field("default", min_length=1, max_length=100)
    model_id: str = Field(min_length=1, max_length=200)
    input_tokens: int = Field(1000, ge=0, le=2000000)
    output_tokens: int = Field(500, ge=0, le=2000000)
    cached_input_tokens: int = Field(0, ge=0, le=2000000)
    objective: Literal["balanced", "lowest_cost", "lowest_latency", "highest_reliability"] = "balanced"
    manual_channel_id: str | None = None
    requirements: Requirements = Field(default_factory=Requirements)


class BudgetInput(StrictModel):
    project_id: str = Field("default", min_length=1, max_length=100)
    currency: str = Field("USD", pattern=r"^[A-Z]{3}$")
    daily_limit: str | None = None
    monthly_limit: str | None = None


class MessageInput(StrictModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100000)


class ExecuteInput(StrictModel):
    request_id: str = Field(min_length=1, max_length=100)
    profile: CompareInput
    messages: list[MessageInput] = Field(min_length=1, max_length=100)
    explicit_confirmation: bool = False


class ReplayInput(StrictModel):
    objective: Literal["balanced", "lowest_cost", "highest_reliability"] = "lowest_cost"
    excluded_channels: list[str] = Field(default_factory=list, max_length=100)
    project_id: str | None = None
    model_id: str | None = None
    currency: str | None = None


class AccessInput(StrictModel):
    stream: Literal["unknown", "supported", "unsupported"] = "unknown"
    tool_calling: Literal["unknown", "supported", "unsupported"] = "unknown"
    max_context_tokens: int | None = Field(None, ge=1, le=2000000)
    storage_regions: list[str] = Field(default_factory=list, max_length=20)
    retention_days: int | None = Field(None, ge=0, le=3650)
    training_use: Literal["unknown", "not_used", "used"] = "unknown"
    sensitive_tasks_allowed: bool = False
    compliance_labels: list[str] = Field(default_factory=list, max_length=30)
    verification_status: Literal["pending_confirmation", "verified", "account_verified", "contract_verified"] = "pending_confirmation"
    source_urls: list[str] = Field(default_factory=list, max_length=10)
    evidence_reference: str = Field(min_length=1, max_length=1000)


class SettlementInput(StrictModel):
    actual_cost: str
    evidence_reference: str = Field(min_length=1, max_length=1000)


def build_gateway_workspace_router(database_path: Callable[[], Path], principal_for_request: Callable,
                                   authorize: Callable, *, observation_provider: Callable | None = None,
                                   adapter_provider: Callable | None = None,
                                   circuit_provider: Callable | None = None,
                                   clock: Callable | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/v1/gateway", tags=["Gateway workspace"])
    now = clock or (lambda: datetime.now(timezone.utc))

    def services(request: Request, permission: str):
        principal = principal_for_request(request)
        authorize(principal, permission)
        scope = TenantScope(principal.tenant_id, principal.workspace_id)
        path = Path(database_path())
        runtime = GatewayRuntimeService(path, scope, clock=now)
        with sqlite3.connect(path) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS gateway_workspace_reviews_v1(
                tenant_id TEXT,workspace_id TEXT,kind TEXT,subject TEXT,value_json TEXT,
                PRIMARY KEY(tenant_id,workspace_id,kind,subject))""")
            rows = db.execute("SELECT subject,value_json FROM gateway_workspace_reviews_v1 WHERE tenant_id=? AND workspace_id=? AND kind='access'", scope.sql_parameters()).fetchall()
        access = json.loads((ROOT / "config" / "provider_access_policy_v1.json").read_text(encoding="utf-8"))
        for channel, value in rows:
            access["channels"][channel] = json.loads(value)
        decisions = ProviderDecisionService(access_policy=access, clock=now)
        return principal, scope, path, runtime, decisions

    def save_value(path, scope, kind, subject, value):
        with sqlite3.connect(path) as db:
            db.execute("INSERT OR REPLACE INTO gateway_workspace_reviews_v1 VALUES(?,?,?,?,?)",
                (*scope.sql_parameters(), kind, subject, json.dumps(value, ensure_ascii=False, sort_keys=True)))

    def read_value(path, scope, kind, subject):
        with sqlite3.connect(path) as db:
            row = db.execute("SELECT value_json FROM gateway_workspace_reviews_v1 WHERE tenant_id=? AND workspace_id=? AND kind=? AND subject=?", (*scope.sql_parameters(), kind, subject)).fetchone()
        return json.loads(row[0]) if row else None

    def records(request, runtime, decisions, project=None):
        result = runtime.list_records(project_id=project, limit=10000)
        ids = {row["request_id"] for row in result}
        if observation_provider is not None:
            for row in observation_provider(request):
                if row.get("request_id") not in ids and (not project or row.get("project_id") == project):
                    result.append(deepcopy(row))
        offers = {offer["channel_id"]: offer for offer in decisions.catalog()["offers"]}
        for row in result:
            offer = offers.get(row.get("final_channel"))
            if offer:
                identity = row.get("identity") or {}
                row["identity"] = verify_model_identity(row.get("model_id"), offer,
                    actual_model=identity.get("actual_returned_model"), billed_model=identity.get("billed_model"),
                    observed_at=row.get("completed_at") or row.get("occurred_at"))
        return result

    def comparison(body, request, runtime, decisions):
        profile = body.model_dump()
        observed = records(request, runtime, decisions)
        compared = decisions.compare(profile, observations=observed)
        selected = next((row for row in compared["offers"] if row["channel_id"] == compared["selected_channel"]), None)
        currency = selected["currency"] if selected else "USD"
        budget = runtime.budget_status(body.project_id, currency)
        budget["reserved_amount"] = budget["reserved"]
        quoted = [Decimal(row["estimated_cost"]) for row in compared["offers"] if row["eligible"] and row["currency"] == currency]
        # Cached hits are not guaranteed, so reserve the uncached upper estimate.
        conservative = decisions.compare({**profile, "cached_input_tokens": 0}, observations=observed)
        ceilings = {row["channel_id"]: Decimal(row["estimated_cost"]) for row in conservative["offers"]
                    if row["eligible"] and row["currency"] == currency}
        remaining = [Decimal(budget[key]) for key in ("daily_remaining", "monthly_remaining") if budget[key] is not None]
        permitted = [key for key, value in ceilings.items() if not remaining or value <= min(remaining)]
        # Expensive backups may be excluded while an affordable primary remains
        # usable. Unknown billing always stops before any fallback dispatch.
        dispatchable = [key for key in permitted if any(row["channel_id"] == key and row["eligible"] for row in compared["offers"])]
        reserve = max((ceilings[key] for key in dispatchable), default=None) if selected else None
        if selected and selected["channel_id"] not in dispatchable:
            reserve = ceilings.get(selected["channel_id"])
        reasons = [] if selected else ["no_eligible_channel"]
        if selected and reserve is None:
            reasons.append("cost_estimate_unavailable")
        if reserve is not None:
            for period in ("daily", "monthly"):
                if budget[f"{period}_remaining"] is not None and reserve > Decimal(budget[f"{period}_remaining"]):
                    reasons.append(f"{period}_budget_exceeded")
        compared.update(budget=budget, budget_check={"allowed": not reasons, "reasons": reasons,
            "reserve_amount": str(reserve) if reserve is not None else None, "currency": currency,
            "estimated_min": str(min(quoted)) if quoted else None, "estimated_max": str(reserve) if reserve is not None else None,
            "basis": "requested maximum output; uncached input reservation; taxes and provider extras excluded"})
        compared["fallback_order"] = dispatchable
        if reasons and selected:
            available = [Decimal(budget[key]) for key in ("daily_remaining", "monthly_remaining") if budget[key] is not None]
            compared["cheaper_within_budget"] = [row["channel_id"] for row in compared["offers"]
                if row["eligible"] and available and row["channel_id"] in ceilings
                and ceilings[row["channel_id"]] <= min(available)]
        return compared

    def adapter():
        return adapter_provider() if adapter_provider else GatewayProviderAdapter()

    def error(exc):
        code = getattr(exc, "code", str(exc))
        status = 409 if any(word in code for word in ("budget", "idempotency", "in_progress", "not_enabled", "not_configured")) else 400
        raise HTTPException(status, detail={"code": code, "message": str(exc)}) from exc

    @router.get("/catalog")
    async def catalog(request: Request):
        _, _, _, _, decisions = services(request, "decision.read")
        result = decisions.catalog()
        transport = adapter()
        result["execution_readiness"] = {row["channel_id"]: transport.readiness(row) for row in result["offers"]}
        return result

    @router.post("/compare")
    async def compare(body: CompareInput, request: Request):
        _, _, _, runtime, decisions = services(request, "scheduler.decide")
        try:
            return comparison(body, request, runtime, decisions)
        except ValueError as exc:
            error(exc)

    @router.get("/budget")
    async def get_budget(request: Request, project_id: str = "default", currency: str = "USD"):
        _, _, _, runtime, _ = services(request, "decision.read")
        try:
            return runtime.budget_status(project_id, currency)
        except ValueError as exc:
            error(exc)

    @router.put("/budget")
    async def set_budget(body: BudgetInput, request: Request):
        _, _, _, runtime, _ = services(request, "tenant.manage")
        try:
            return runtime.set_budget(body.project_id, body.currency, body.daily_limit, body.monthly_limit)
        except ValueError as exc:
            error(exc)

    @router.put("/access-policy/{channel_id}")
    async def review_access(channel_id: str, body: AccessInput, request: Request):
        principal, scope, path, _, decisions = services(request, "tenant.manage")
        if contains_sensitive_data(body.model_dump()):
            raise HTTPException(400, detail={"code": "credential_in_evidence_rejected"})
        if channel_id not in {row["channel_id"] for row in decisions.catalog()["offers"]}:
            raise HTTPException(404, detail={"code": "unknown_channel"})
        if body.verification_status != "pending_confirmation" and (not body.source_urls or any(not url.startswith("https://") for url in body.source_urls)):
            raise HTTPException(400, detail={"code": "policy_evidence_source_required"})
        value = {**body.model_dump(), "verified_at": now().isoformat(), "reviewed_by": principal.principal_id}
        save_value(path, scope, "access", channel_id, value)
        return {"channel_id": channel_id, "access_policy": value}

    @router.post("/execute")
    async def execute(body: ExecuteInput, request: Request):
        principal, _, _, runtime, decisions = services(request, "scheduler.execute")
        try:
            # Resolve duplicate submissions before a new quote or budget check:
            # an earlier request may already have consumed the remaining budget.
            request_hash = hashlib.sha256(json.dumps(
                {"input": body.model_dump(), "principal_id": principal.principal_id},
                ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
            ).encode("utf-8")).hexdigest()
            existing = runtime.get_record(body.request_id)
            if existing is not None:
                if existing.get("request_input_hash") != request_hash:
                    raise GatewayRuntimeError("idempotency_conflict")
                return {**existing, "deduplicated": True, "response_content_retained": False}
            compared = comparison(body.profile, request, runtime, decisions)
            if not compared["budget_check"]["allowed"]:
                raise GatewayRuntimeError(compared["budget_check"]["reasons"][0])
            messages = [row.model_dump() for row in body.messages]
            minimum = len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) + 1024
            if body.profile.input_tokens < minimum:
                raise HTTPException(400, detail={"code": "input_estimate_too_low", "minimum_input_tokens": minimum,
                    "message": "Raise the conservative input token estimate and obtain a new quote."})
            offered = [row for row in compared["offers"] if row["eligible"] and row["channel_id"] in compared["fallback_order"]]
            selected = next(row for row in offered if row["channel_id"] == compared["selected_channel"])
            ordered = [selected, *sorted((row for row in offered if row is not selected), key=lambda row: (-(row["score"] or 0), row["channel_id"]))]
            payload = {**body.profile.model_dump(), "model_id": compared["model_id"],
                       "user_id": principal.principal_id, "messages": messages,
                       "request_input_hash": request_hash,
                       "explicit_confirmation": body.explicit_confirmation}
            transport = adapter()
            configured = [row for row in ordered if transport.readiness(row)["ready"]]
            if not configured or configured[0]["channel_id"] != selected["channel_id"]:
                raise GatewayAdapterError("provider_adapter_not_configured")
            for offer in configured:
                transport.validate(offer, payload)
            # Dispatch from the stable reviewed mapping, not volatile health/quote fields.
            raw_offers = {row["channel_id"]: row for rows in decisions.mapping["models"].values() for row in rows}
            channel_order = [{**deepcopy(raw_offers[row["channel_id"]]), "model_id": compared["model_id"]} for row in configured]
            emitted = {}
            def invoke(offer, task, attempt_id):
                result = transport(offer, task, attempt_id)
                if result.get("success") is True:
                    emitted["response_content"] = result.get("response_content")
                return result
            circuit = circuit_provider(request) if circuit_provider else None
            result = await asyncio.to_thread(runtime.execute, body.request_id, body.profile.project_id, compared["budget_check"]["currency"],
                compared["budget_check"]["reserve_amount"], payload, channel_order, invoke,
                circuit_is_open=circuit, max_attempts=2, identity_verifier=verify_model_identity)
            if result.get("final_channel"):
                result["identity"] = verify_model_identity(compared["model_id"], {**raw_offers[result["final_channel"]], "model_id": compared["model_id"]},
                    actual_model=result["identity"].get("actual_returned_model"), billed_model=result["identity"].get("billed_model"), observed_at=now().isoformat())
            return {**result, **emitted}
        except ValueError as exc:
            error(exc)

    @router.post("/settlements/{request_id}")
    async def reconcile(request_id: str, body: SettlementInput, request: Request):
        principal, scope, path, runtime, _ = services(request, "evidence.import")
        if contains_sensitive_data(body.evidence_reference):
            raise HTTPException(400, detail={"code": "credential_in_evidence_rejected"})
        try:
            result = runtime.settle(request_id, body.actual_cost)
            save_value(path, scope, "settlement", request_id, {"evidence_reference": body.evidence_reference,
                "actual_cost": body.actual_cost, "reviewed_by": principal.principal_id, "reviewed_at": now().isoformat()})
            return result
        except ValueError as exc:
            error(exc)

    @router.get("/records")
    async def list_records(request: Request, project_id: str | None = None):
        _, _, _, runtime, decisions = services(request, "decision.read")
        items = records(request, runtime, decisions, project_id)
        return {"items": items, "total": len(items), "source_type": "observed_gateway_records"}

    @router.get("/analytics")
    async def analytics(request: Request, period: Literal["day", "week", "month"] = "month", project_id: str | None = None):
        _, _, _, runtime, decisions = services(request, "decision.read")
        return GatewayInsightsService(clock=now).analyze(records(request, runtime, decisions, project_id), period)

    @router.get("/alerts")
    async def alerts(request: Request):
        _, scope, path, runtime, decisions = services(request, "decision.read")
        prior = read_value(path, scope, "price_snapshot", "latest")
        current = []
        for row in decisions.cost_catalog["channel_prices"]:
            for tier in row.get("pricing_tiers") or [{}]:
                current.append({**row, **tier, "is_mock": False,
                    "verification_status": "provider_documented",
                    "effective_from": tier.get("valid_from") or row["verified_at"],
                    "effective_until": tier.get("valid_until"), "pricing_tiers": []})
        digest = hashlib.sha256(json.dumps(current, sort_keys=True).encode()).hexdigest()
        if prior is None or prior.get("digest") != digest:
            if prior:
                save_value(path, scope, "price_snapshot", "previous", prior)
            save_value(path, scope, "price_snapshot", "latest", {"digest": digest, "prices": current})
        previous = read_value(path, scope, "price_snapshot", "previous")
        budget = runtime.budget_status("default", "USD")
        quota = [{"channel_id": "project:default", "remaining": budget["monthly_remaining"], "limit": budget["monthly_limit"],
                  "observed_at": now().isoformat(), "is_mock": False}] if budget["monthly_limit"] is not None else []
        items = GatewayInsightsService(clock=now).alerts(records(request, runtime, decisions),
            offers=decisions.catalog()["offers"], previous_prices=previous["prices"] if previous else [],
            current_prices=current, quotas=quota)
        for item in items:
            if item.get("channel_id") == "project:default":
                item["type"] = "project_budget_remaining_low" if item["type"] == "quota_low" else "project_budget_unknown"
                item["message"] = "Project monthly budget remaining is below its configured threshold. This is not a provider account quota."
        if budget["budget_overrun"]:
            items.append({"alert_id": "budget-overrun-default-USD", "severity": "critical", "type": "budget_overrun", "message": "Confirmed charges plus outstanding reservations exceed the configured project budget.", "observed_at": now().isoformat()})
        return {"items": items, "delivery": "in_app", "outbound_notifications": False}

    @router.post("/replay")
    async def replay(body: ReplayInput, request: Request):
        _, _, _, runtime, decisions = services(request, "scheduler.decide")
        try:
            return GatewayInsightsService(clock=now).replay(records(request, runtime, decisions), body.model_dump(exclude_none=True), decisions)
        except ValueError as exc:
            error(exc)

    return router
