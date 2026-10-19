"""Durable scoped budgets and controlled execution with an injected adapter.

This module does not perform network I/O. Provider billing is not made
idempotent by local deduplication: an ambiguous attempt is never retried.
Confirmed partial charges and the full original reservation both consume
budget while billing is unresolved. This conservative hold is released by
an explicit final-cost settlement; it is not an assertion of duplicate billing.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
from typing import Any, Callable

from backend.security.redaction import redact_text, redact_value
from backend.tenant_security import TenantScope


class GatewayRuntimeError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _money(value: Any, *, nullable: bool = False) -> Decimal | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d+)?", value):
        raise GatewayRuntimeError("amount_must_be_nonnegative_decimal_string")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise GatewayRuntimeError("invalid_amount") from exc
    if not result.is_finite() or result < 0 or len(value) > 100:
        raise GatewayRuntimeError("invalid_amount")
    return result


def _text_money(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value):
        raise GatewayRuntimeError("invalid_identifier")
    return value


def _currency(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z]{3}", value):
        raise GatewayRuntimeError("invalid_currency")
    return value


def _json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise GatewayRuntimeError("invalid_json_payload") from exc


class GatewayRuntimeService:
    def __init__(self, path: str | Path, scope: TenantScope, clock: Callable | None = None):
        if not isinstance(scope, TenantScope):
            raise GatewayRuntimeError("tenant_scope_required")
        self.path = Path(path)
        self.scope = scope
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS gateway_budgets_v1 (
                tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
                currency TEXT NOT NULL, daily_limit TEXT, monthly_limit TEXT,
                PRIMARY KEY(tenant_id,workspace_id,project_id,currency));
              CREATE TABLE IF NOT EXISTS gateway_reservations_v1 (
                tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, request_id TEXT NOT NULL,
                project_id TEXT NOT NULL, currency TEXT NOT NULL, amount TEXT NOT NULL,
                digest TEXT NOT NULL, occurred_at TEXT NOT NULL, status TEXT NOT NULL,
                actual_cost TEXT, uncertain INTEGER NOT NULL DEFAULT 0, record_json TEXT,
                PRIMARY KEY(tenant_id,workspace_id,request_id));
            """)

    @contextmanager
    def _db(self, *, immediate: bool = False):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            if immediate:
                db.execute("BEGIN IMMEDIATE")
            with localcontext() as context:
                context.prec = 160
                yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _now(self) -> str:
        current = self.clock()
        if not isinstance(current, datetime) or current.tzinfo is None:
            raise GatewayRuntimeError("clock_must_be_timezone_aware")
        return current.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    @property
    def _scope(self):
        return self.scope.sql_parameters()

    def set_budget(self, project_id: str, currency: str, daily_limit: str | None,
                   monthly_limit: str | None) -> dict:
        _identifier(project_id)
        _currency(currency)
        daily = _text_money(_money(daily_limit, nullable=True))
        monthly = _text_money(_money(monthly_limit, nullable=True))
        with self._db(immediate=True) as db:
            db.execute("""INSERT INTO gateway_budgets_v1 VALUES(?,?,?,?,?,?)
              ON CONFLICT(tenant_id,workspace_id,project_id,currency) DO UPDATE SET
              daily_limit=excluded.daily_limit,monthly_limit=excluded.monthly_limit""",
                       (*self._scope, project_id, currency, daily, monthly))
            return self._budget_status(db, project_id, currency)

    def _budget_status(self, db, project_id: str, currency: str) -> dict:
        now = self._now()
        budget = db.execute("""SELECT * FROM gateway_budgets_v1 WHERE
            tenant_id=? AND workspace_id=? AND project_id=? AND currency=?""",
                            (*self._scope, project_id, currency)).fetchone()
        daily = Decimal(0)
        monthly = Decimal(0)
        reserved = Decimal(0)
        for row in db.execute("""SELECT * FROM gateway_reservations_v1 WHERE
            tenant_id=? AND workspace_id=? AND project_id=? AND currency=?""",
                              (*self._scope, project_id, currency)):
            if row["status"] in {"reserved", "in_progress", "unknown_cost"}:
                reserved += Decimal(row["amount"])
            if row["actual_cost"] is not None:
                cost = Decimal(row["actual_cost"])
                if row["occurred_at"][:10] == now[:10]:
                    daily += cost
                if row["occurred_at"][:7] == now[:7]:
                    monthly += cost
        result = {"project_id": project_id, "currency": currency, "as_of": now,
                  "reserved": _text_money(reserved), "daily_spent": _text_money(daily),
                  "monthly_spent": _text_money(monthly), "period_timezone": "UTC",
                  "reservation_accounting": "confirmed_cost_plus_full_unresolved_reservation"}
        overrun = False
        for period, spent in (("daily", daily), ("monthly", monthly)):
            limit = Decimal(budget[f"{period}_limit"]) if budget and budget[f"{period}_limit"] is not None else None
            remaining = None if limit is None else limit - spent - reserved
            result[f"{period}_limit"] = _text_money(limit)
            result[f"{period}_remaining"] = _text_money(remaining)
            overrun = overrun or (remaining is not None and remaining < 0)
        result["budget_overrun"] = overrun
        return result

    def budget_status(self, project_id: str, currency: str) -> dict:
        _identifier(project_id)
        _currency(currency)
        with self._db() as db:
            return self._budget_status(db, project_id, currency)

    def _row(self, db, request_id: str):
        return db.execute("""SELECT * FROM gateway_reservations_v1 WHERE
            tenant_id=? AND workspace_id=? AND request_id=?""", (*self._scope, request_id)).fetchone()

    @staticmethod
    def _reservation(row) -> dict:
        return {"request_id": row["request_id"], "project_id": row["project_id"],
                "status": row["status"], "reserved_amount": row["amount"],
                "currency": row["currency"], "actual_cost": row["actual_cost"],
                "billing_uncertain": bool(row["uncertain"]), "occurred_at": row["occurred_at"]}

    def _reserve(self, db, request_id, project_id, currency, amount, digest):
        existing = self._row(db, request_id)
        if existing:
            if (existing["digest"], existing["project_id"], existing["currency"], Decimal(existing["amount"])) != (
                    digest, project_id, currency, Decimal(amount)):
                raise GatewayRuntimeError("idempotency_conflict")
            return existing
        status = self._budget_status(db, project_id, currency)
        for period in ("daily", "monthly"):
            if status[f"{period}_remaining"] is not None and Decimal(amount) > Decimal(status[f"{period}_remaining"]):
                raise GatewayRuntimeError(f"{period}_budget_exceeded")
        db.execute("INSERT INTO gateway_reservations_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                   (*self._scope, request_id, project_id, currency, amount, digest,
                    self._now(), "reserved", None, 0, None))
        return self._row(db, request_id)

    def reserve(self, request_id: str, project_id: str, currency: str, amount: str,
                payload_digest: str) -> dict:
        _identifier(request_id)
        _identifier(project_id)
        _currency(currency)
        normalized = _text_money(_money(amount))
        if not isinstance(payload_digest, str) or not payload_digest or len(payload_digest) > 256:
            raise GatewayRuntimeError("invalid_payload_digest")
        with self._db(immediate=True) as db:
            return self._reservation(self._reserve(db, request_id, project_id, currency, normalized, payload_digest))

    def release(self, request_id: str) -> dict:
        _identifier(request_id)
        with self._db(immediate=True) as db:
            row = self._row(db, request_id)
            if row is None:
                raise GatewayRuntimeError("reservation_not_found")
            if row["uncertain"] or row["status"] == "in_progress":
                raise GatewayRuntimeError("billing_reconciliation_required")
            if row["status"] != "settled":
                db.execute("""UPDATE gateway_reservations_v1 SET status='released' WHERE
                  tenant_id=? AND workspace_id=? AND request_id=?""", (*self._scope, request_id))
            return self._reservation(self._row(db, request_id))

    def settle(self, request_id: str, actual_cost: str | None = None) -> dict:
        _identifier(request_id)
        cost = _text_money(_money(actual_cost, nullable=True))
        with self._db(immediate=True) as db:
            row = self._row(db, request_id)
            if row is None:
                raise GatewayRuntimeError("reservation_not_found")
            if row["status"] == "in_progress":
                raise GatewayRuntimeError("execution_in_progress")
            if row["status"] == "released":
                raise GatewayRuntimeError("reservation_released")
            if row["status"] == "settled" and (cost is None or Decimal(cost) != Decimal(row["actual_cost"])):
                raise GatewayRuntimeError("settlement_conflict")
            self._settle_row(db, request_id, cost if cost is not None else row["actual_cost"], cost is None)
            result = self._reservation(self._row(db, request_id))
            result["budget_overrun"] = self._budget_status(db, row["project_id"], row["currency"])["budget_overrun"]
            if row["record_json"]:
                record = json.loads(row["record_json"])
                record.update(actual_cost=result["actual_cost"], cost_status="unknown" if cost is None else "settled",
                              budget_overrun=result["budget_overrun"])
                db.execute("""UPDATE gateway_reservations_v1 SET record_json=? WHERE
                  tenant_id=? AND workspace_id=? AND request_id=?""", (_json(record), *self._scope, request_id))
            return result

    def _settle_row(self, db, request_id, cost, uncertain):
        db.execute("""UPDATE gateway_reservations_v1 SET status=?,actual_cost=?,uncertain=?
          WHERE tenant_id=? AND workspace_id=? AND request_id=?""",
                   ("unknown_cost" if uncertain else "settled", cost, int(uncertain), *self._scope, request_id))

    def _persist(self, record):
        with self._db(immediate=True) as db:
            db.execute("""UPDATE gateway_reservations_v1 SET record_json=? WHERE
              tenant_id=? AND workspace_id=? AND request_id=?""", (_json(record), *self._scope, record["request_id"]))

    @staticmethod
    def _safe_result(raw):
        if not isinstance(raw, dict) or not isinstance(raw.get("success"), bool):
            raise GatewayRuntimeError("invalid_executor_result")
        result = {"success": raw["success"], "billing_state": raw.get("billing_state", "unknown"),
                  "output_started": raw.get("output_started") is not False, "is_mock": raw.get("is_mock") is True,
                  "network_called": raw.get("network_called") is True}
        if result["billing_state"] not in {"charged", "not_charged", "unknown"}:
            raise GatewayRuntimeError("invalid_billing_state")
        result["actual_cost"] = _text_money(_money(raw.get("actual_cost"), nullable=True))
        if result["billing_state"] == "not_charged" and result["actual_cost"] not in {None, "0", "0.0"} and Decimal(result["actual_cost"]) != 0:
            raise GatewayRuntimeError("conflicting_billing_state")
        status = raw.get("http_status")
        result["http_status"] = status if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599 else None
        for field in ("error_category", "actual_model", "billed_model", "source_type", "source_reference"):
            value = raw.get(field)
            result[field] = redact_text(value, maximum_length=256) if isinstance(value, str) else None
        for field in ("latency_ms", "input_tokens", "output_tokens", "cached_input_tokens"):
            value = raw.get(field)
            valid = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
            if field.endswith("tokens"):
                valid = valid and isinstance(value, int)
            result[field] = value if valid else None
        return result

    @staticmethod
    def _request_profile(payload):
        profile = {}
        for field in ("input_tokens", "output_tokens", "cached_input_tokens"):
            value = payload.get(field)
            profile[field] = value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
        allowed = {"stream", "tools", "tool_calling", "json_mode", "multimodal", "min_context_tokens",
                   "data_region", "allow_training", "allow_retention", "sensitive", "long_context",
                   "context_tokens", "allowed_regions", "require_no_training"}
        requirements = payload.get("requirements", {})
        clean = {}
        if isinstance(requirements, dict):
            for key, value in requirements.items():
                if key not in allowed:
                    continue
                if key == "allowed_regions":
                    valid = isinstance(value, list) and len(value) <= 20 and all(
                        isinstance(region, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", region)
                        for region in value)
                elif key in {"context_tokens", "min_context_tokens"}:
                    valid = isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 10**12
                elif key == "data_region":
                    valid = isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", value)
                else:
                    valid = isinstance(value, bool)
                if not valid:
                    raise GatewayRuntimeError("invalid_replay_requirements")
                clean[key] = value
        profile["requirements"] = clean
        return profile

    def execute(self, request_id: str, project_id: str, currency: str, reserve_amount: str,
                payload: dict, channel_order: list[dict], executor: Callable,
                circuit_is_open: Callable | None = None, max_attempts: int = 2,
                identity_verifier: Callable | None = None) -> dict:
        _identifier(request_id)
        _identifier(project_id)
        _currency(currency)
        amount = _text_money(_money(reserve_amount))
        if not isinstance(payload, dict) or not isinstance(channel_order, list) or not channel_order:
            raise GatewayRuntimeError("invalid_execution_input")
        request_input_hash = payload.get("request_input_hash")
        if request_input_hash is not None and (not isinstance(request_input_hash, str) or
                not re.fullmatch(r"[0-9a-fA-F]{64}", request_input_hash)):
            raise GatewayRuntimeError("invalid_request_input_hash")
        if isinstance(max_attempts, bool) or not isinstance(max_attempts, int) or not 1 <= max_attempts <= 10:
            raise GatewayRuntimeError("invalid_max_attempts")
        seen = set()
        for offer in channel_order:
            if not isinstance(offer, dict):
                raise GatewayRuntimeError("invalid_channel_order")
            channel = _identifier(offer.get("channel_id"))
            if channel in seen:
                raise GatewayRuntimeError("duplicate_channel")
            seen.add(channel)
        fingerprint = hashlib.sha256(_json({"payload": payload, "channel_order": channel_order,
            "project_id": project_id, "currency": currency, "reserve_amount": amount,
            "max_attempts": max_attempts}).encode("utf-8")).hexdigest()
        model = payload.get("model_id") or payload.get("requested_model")
        model = redact_text(model, maximum_length=256) if isinstance(model, str) else None
        with self._db(immediate=True) as db:
            row = self._reserve(db, request_id, project_id, currency, amount, fingerprint)
            if row["record_json"]:
                return json.loads(row["record_json"])
            if row["status"] != "reserved":
                raise GatewayRuntimeError("reservation_not_executable")
            record = {"request_id": request_id, "project_id": project_id,
                "user_id": redact_text(payload.get("user_id"), maximum_length=128) if payload.get("user_id") else None,
                "model_id": model, "currency": currency, "occurred_at": row["occurred_at"],
                "request_input_hash": request_input_hash.lower() if request_input_hash else None,
                "completed_at": None,
                "status": "in_progress", "selected_channel": channel_order[0]["channel_id"],
                "final_channel": None, "estimated_cost": amount, "actual_cost": None,
                "cost_status": "reserved", "latency_ms": None, "success": None,
                "request_profile": self._request_profile(payload), "network_called": False,
                "input_tokens": None, "output_tokens": None, "cached_input_tokens": None,
                "is_mock": True, "attempts": [], "fallback_trace": [], "identity": {
                    "requested_model": model, "provider_model_alias": None,
                    "actual_returned_model": None, "billed_model": None,
                    "verification_status": "unverified", "last_verified_at": None}}
            db.execute("""UPDATE gateway_reservations_v1 SET status='in_progress',record_json=? WHERE
                tenant_id=? AND workspace_id=? AND request_id=?""", (_json(record), *self._scope, request_id))
        total = Decimal(0)
        uncertain = False
        success = False
        latencies = []
        for offer in channel_order:
            channel = offer["channel_id"]
            if len(record["attempts"]) >= max_attempts:
                break
            try:
                open_circuit = bool(circuit_is_open(channel)) if circuit_is_open else False
            except Exception:
                open_circuit = True
            if open_circuit:
                record["fallback_trace"].append({"channel_id": channel, "action": "skipped", "reason": "circuit_open"})
                self._persist(record)
                continue
            attempt_material = _json({"tenant_id": self.scope.tenant_id,
                "workspace_id": self.scope.workspace_id, "request_id": request_id,
                "fingerprint": fingerprint, "attempt": len(record["attempts"]) + 1})
            attempt_id = "ATT-" + hashlib.sha256(attempt_material.encode("utf-8")).hexdigest()[:32]
            attempt = {"attempt_id": attempt_id, "channel_id": channel,
                       "provider_model_id": redact_text(offer.get("provider_model_id"), maximum_length=256),
                       "status": "in_progress"}
            record["attempts"].append(attempt)
            record["fallback_trace"].append({"channel_id": channel, "attempt_id": attempt_id, "action": "dispatch"})
            self._persist(record)
            try:
                raw = self._safe_result(executor(offer, payload, attempt_id))
            except Exception:
                raw = self._safe_result({"success": False, "billing_state": "unknown",
                    "error_category": "executor_exception", "is_mock": False})
            attempt.update(raw)
            attempt["status"] = "success" if raw["success"] else "failed"
            record["is_mock"] = record["is_mock"] and raw["is_mock"]
            record["network_called"] = record["network_called"] or raw["network_called"]
            record["final_channel"] = channel
            if raw["latency_ms"] is not None:
                latencies.append(raw["latency_ms"])
            if raw["actual_cost"] is not None:
                with localcontext() as context:
                    context.prec = 160
                    total += Decimal(raw["actual_cost"])
            unresolved = raw["billing_state"] == "unknown" or (raw["billing_state"] == "charged" and raw["actual_cost"] is None)
            # A successful response without cost cannot be assumed free, even if the adapter says not_charged.
            unresolved = unresolved or (raw["success"] and raw["actual_cost"] is None)
            uncertain = uncertain or unresolved
            alias = attempt["provider_model_id"]
            actual = raw["actual_model"]
            record["identity"] = {"requested_model": model, "provider_model_alias": alias,
                "actual_returned_model": actual, "billed_model": raw["billed_model"],
                "verification_status": ("matched" if actual == alias else "mismatch") if actual and alias else "unverified",
                "last_verified_at": self._now() if actual and alias else None}
            if identity_verifier is not None:
                try:
                    verified = identity_verifier(model, offer, actual_model=actual,
                        billed_model=raw["billed_model"], observed_at=self._now())
                    if not isinstance(verified, dict):
                        raise ValueError("invalid_verifier_result")
                    allowed_identity = {"requested_model", "provider_model_alias", "actual_returned_model",
                        "billed_model", "verification_status", "last_verified_at", "mismatch_reasons", "evidence_note"}
                    record["identity"] = redact_value({key: value for key, value in verified.items() if key in allowed_identity})
                except Exception:
                    record["identity"]["verification_status"] = "verification_error"
                    record["identity"]["last_verified_at"] = None
            if raw["success"]:
                success = True
                record["fallback_trace"].append({"channel_id": channel, "action": "completed"})
                break
            transient = raw["error_category"] in {"timeout", "rate_limit", "temporary_server_error", "429", "502", "503"} or raw["http_status"] in {429, 502, 503}
            terminal = raw["error_category"] in {"invalid_request", "authentication_failure", "authentication_error", "user_authentication_failure", "invalid_parameters", "invalid_parameter"} or raw["http_status"] in {400, 401, 403, 422}
            retry = transient and not terminal and not raw["output_started"] and raw["billing_state"] == "not_charged"
            reason = "retryable_not_charged" if retry else ("output_started" if raw["output_started"] else "billing_uncertain" if unresolved else "non_retryable")
            record["fallback_trace"].append({"channel_id": channel, "action": "retry_eligible" if retry else "stopped", "reason": reason})
            self._persist(record)
            if not retry:
                break
        record.update(status="success" if success else "failed", success=success,
                      completed_at=self._now(),
                      actual_cost=None if uncertain and total == 0 else _text_money(total),
                      cost_status="unknown" if uncertain else "settled",
                      latency_ms=sum(latencies) if latencies and len(latencies) == len(record["attempts"]) else None)
        for field in ("input_tokens", "output_tokens", "cached_input_tokens"):
            values = [attempt.get(field) for attempt in record["attempts"]]
            record[field] = sum(values) if values and all(value is not None for value in values) else None
        if not record["attempts"]:
            record["is_mock"] = False
            record["cost_status"] = "not_charged"
        if success:
            stop_reason = "completed"
        elif not record["attempts"]:
            stop_reason = "no_available_channel"
        elif record["fallback_trace"][-1]["action"] == "stopped":
            stop_reason = record["fallback_trace"][-1]["reason"]
        else:
            stop_reason = "max_attempts_reached" if len(record["attempts"]) >= max_attempts else "channels_exhausted"
        record["stop_reason"] = stop_reason
        record["fallback_trace"].append({"action": "final", "status": record["status"],
            "final_channel": record["final_channel"], "attempt_count": len(record["attempts"]), "reason": stop_reason})
        with self._db(immediate=True) as db:
            self._settle_row(db, request_id, record["actual_cost"], uncertain)
            record["budget_overrun"] = self._budget_status(db, project_id, currency)["budget_overrun"]
            db.execute("""UPDATE gateway_reservations_v1 SET record_json=? WHERE
              tenant_id=? AND workspace_id=? AND request_id=?""", (_json(record), *self._scope, request_id))
        return record

    def get_record(self, request_id: str) -> dict | None:
        _identifier(request_id)
        with self._db() as db:
            row = self._row(db, request_id)
            return json.loads(row["record_json"]) if row and row["record_json"] else None

    def list_records(self, project_id: str | None = None, limit: int = 1000,
                     include_mock: bool = False) -> list[dict]:
        if project_id is not None:
            _identifier(project_id)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 10000:
            raise GatewayRuntimeError("invalid_limit")
        sql = "SELECT record_json FROM gateway_reservations_v1 WHERE tenant_id=? AND workspace_id=? AND record_json IS NOT NULL"
        params = [*self._scope]
        if project_id:
            sql += " AND project_id=?"
            params.append(project_id)
        sql += " ORDER BY occurred_at DESC,request_id ASC"
        with self._db() as db:
            records = [json.loads(row[0]) for row in db.execute(sql, params)]
        return [r for r in records if include_mock or not r["is_mock"]][:limit]
