"""Tenant-scoped external Host control plane for the Formal Agent Skill runtime."""
from __future__ import annotations

import ipaddress
import json
import socket
import sqlite3
import ssl
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import quote, urljoin, urlsplit

from backend.agent_skill_host_credential_vault import AgentSkillHostCredentialVault
from backend.tenant_security import TenantScope


class AgentSkillHostError(RuntimeError):
    def __init__(self, code: str, **safe_context: Any) -> None:
        super().__init__(code)
        self.code = code
        self.safe_context = redact(safe_context)


@dataclass(frozen=True)
class HostTransportResponse:
    status_code: int
    payload: Any
    headers: Mapping[str, str] | None = None
    latency_ms: int | None = None
    tls_verified: bool = True


class HostTransport(Protocol):
    def request(self, *, method: str, url: str, headers: Mapping[str, str],
                json_body: Any | None, timeout_seconds: int,
                follow_redirects: bool) -> HostTransportResponse: ...


class StandardHostTransport:
    """Small HTTPS JSON transport with redirects disabled and bounded bodies."""

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    def request(self, *, method: str, url: str, headers: Mapping[str, str],
                json_body: Any | None, timeout_seconds: int,
                follow_redirects: bool) -> HostTransportResponse:
        body = None if json_body is None else _json(json_body).encode("utf-8")
        safe_headers = dict(headers)
        if body is not None:
            safe_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, method=method, headers=safe_headers)
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
            self._NoRedirect())
        started = time.monotonic()
        try:
            response = opener.open(request, timeout=timeout_seconds)
        except urllib.error.HTTPError as exc:
            response = exc
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise AgentSkillHostError("host_protocol_incompatible")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AgentSkillHostError("host_protocol_incompatible") from exc
        return HostTransportResponse(
            status_code=int(response.status), payload=payload,
            headers={str(k).lower(): str(v) for k, v in response.headers.items()},
            latency_ms=int((time.monotonic() - started) * 1000),
            tls_verified=urlsplit(url).scheme == "https")


SENSITIVE_KEYS = frozenset({
    "authorization", "cookie", "set-cookie", "token", "access_token",
    "refresh_token", "api_key", "apikey", "secret", "client_secret", "credential",
})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): "<redacted>" if str(k).casefold().replace("-", "_") in SENSITIVE_KEYS
                else redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    return value


class AgentSkillHostService:
    HOST_STATES = frozenset({"not_configured", "pending_test", "testing", "connected",
                             "authentication_failed", "network_failed",
                             "protocol_incompatible", "disabled"})
    PROTOCOLS = frozenset({"formal-agent-skill", "mcp"})

    @staticmethod
    def _auth_type(value: str) -> str:
        return "bearer" if value == "bearer_token" else value

    def __init__(self, database_path: str | Path, *, scope: TenantScope | None = None,
                 vault: AgentSkillHostCredentialVault | None = None,
                 transport: HostTransport | None = None,
                 allowed_hosts: set[str] | frozenset[str] | None = None,
                 allow_loopback_http: bool = False,
                 loopback_ports: set[int] | frozenset[int] | None = None,
                 request_timeout_seconds: int = 30,
                 dns_resolver: Callable[..., Any] = socket.getaddrinfo) -> None:
        self.path = Path(database_path)
        self.scope = scope or TenantScope.local_development()
        self.vault = vault or AgentSkillHostCredentialVault(self.scope)
        self.transport = transport or StandardHostTransport()
        self.allowed_hosts = frozenset(str(h).casefold() for h in
            (allowed_hosts or {"api-uat.weimeta.cn"}))
        self.allow_loopback_http = bool(allow_loopback_http)
        self.loopback_ports = frozenset(loopback_ports or {8010})
        self.request_timeout_seconds = min(max(int(request_timeout_seconds), 1), 30)
        self.dns_resolver = dns_resolver
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _init_schema(self) -> None:
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS formal_agent_skill_hosts(
              host_id TEXT PRIMARY KEY,host_name TEXT NOT NULL,host_type TEXT NOT NULL,base_url TEXT,
              enabled INTEGER NOT NULL DEFAULT 0,connection_status TEXT NOT NULL DEFAULT 'not_tested',
              last_tested_at TEXT,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL)""")
            existing = {row[1] for row in db.execute("PRAGMA table_info(formal_agent_skill_hosts)")}
            additions = {
                "environment":"TEXT NOT NULL DEFAULT 'china_uat'", "protocol":"TEXT NOT NULL DEFAULT 'formal-agent-skill'",
                "protocol_version":"TEXT NOT NULL DEFAULT '1.0'", "auth_type":"TEXT NOT NULL DEFAULT 'none'",
                "secret_ref":"TEXT", "credential_fingerprint":"TEXT", "capabilities_json":"TEXT NOT NULL DEFAULT '[]'",
                "last_test_result_json":"TEXT", "last_invoked_at":"TEXT", "created_at":"TEXT", "updated_at":"TEXT",
            }
            for name, declaration in additions.items():
                if name not in existing:
                    db.execute(f"ALTER TABLE formal_agent_skill_hosts ADD COLUMN {name} {declaration}")
            db.execute("""UPDATE formal_agent_skill_hosts SET connection_status='pending_test'
              WHERE connection_status='not_tested'""")
            db.executescript("""
            CREATE TABLE IF NOT EXISTS formal_agent_skill_host_installations(
              installation_id TEXT PRIMARY KEY,host_id TEXT NOT NULL,skill_id TEXT NOT NULL,
              skill_version TEXT NOT NULL,status TEXT NOT NULL,installed_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
              UNIQUE(host_id,skill_id,tenant_id,workspace_id));
            CREATE TABLE IF NOT EXISTS formal_agent_skill_host_invocations(
              invocation_id TEXT PRIMARY KEY,audit_id TEXT NOT NULL,host_id TEXT NOT NULL,
              skill_id TEXT NOT NULL,skill_version TEXT NOT NULL,operator_id TEXT NOT NULL,
              permission_decision TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT NOT NULL,
              latency_ms INTEGER NOT NULL,result TEXT NOT NULL,network_called INTEGER NOT NULL,
              write_occurred INTEGER NOT NULL,request_id TEXT,decision_id TEXT,safe_result_json TEXT NOT NULL,
              tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS formal_agent_skill_host_audit(
              audit_id TEXT PRIMARY KEY,host_id TEXT,operation TEXT NOT NULL,operator_id TEXT NOT NULL,
              result TEXT NOT NULL,error_code TEXT,safe_detail_json TEXT NOT NULL,created_at TEXT NOT NULL,
              tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_skill_hosts_scope ON formal_agent_skill_hosts(tenant_id,workspace_id);
            CREATE INDEX IF NOT EXISTS idx_skill_host_inv_scope ON formal_agent_skill_host_invocations(tenant_id,workspace_id,host_id);
            CREATE INDEX IF NOT EXISTS idx_skill_host_audit_scope ON formal_agent_skill_host_audit(tenant_id,workspace_id,host_id);
            """)
            self._deduplicate_host_registry(db)

    def _deduplicate_host_registry(self, db: sqlite3.Connection) -> None:
        """Merge accidental duplicate Host registrations without losing evidence.

        The canonical identity intentionally includes protocol version so an
        incompatible-protocol test remains a separate, truthful Host record.
        """
        rows = db.execute("""SELECT * FROM formal_agent_skill_hosts
          ORDER BY tenant_id,workspace_id,base_url,host_type,protocol,protocol_version,
                   enabled DESC,(connection_status='connected') DESC,updated_at DESC,created_at DESC""").fetchall()
        groups: dict[tuple[str, ...], list[sqlite3.Row]] = {}
        for row in rows:
            key = tuple(str(row[name] or "") for name in (
                "tenant_id", "workspace_id", "base_url", "host_type", "protocol", "protocol_version"))
            groups.setdefault(key, []).append(row)
        for duplicates in groups.values():
            if len(duplicates) < 2 or not duplicates[0]["base_url"]:
                continue
            keeper = duplicates[0]
            merged = 0
            for duplicate in duplicates[1:]:
                duplicate_id = str(duplicate["host_id"])
                keeper_id = str(keeper["host_id"])
                installations = db.execute(
                    "SELECT * FROM formal_agent_skill_host_installations WHERE host_id=?", (duplicate_id,)).fetchall()
                for installation in installations:
                    current = db.execute("""SELECT * FROM formal_agent_skill_host_installations
                      WHERE host_id=? AND skill_id=? AND tenant_id=? AND workspace_id=?""",
                      (keeper_id, installation["skill_id"], installation["tenant_id"],
                       installation["workspace_id"])).fetchone()
                    if current is None:
                        db.execute("UPDATE formal_agent_skill_host_installations SET host_id=? WHERE installation_id=?",
                                   (keeper_id, installation["installation_id"]))
                    else:
                        if str(installation["updated_at"]) > str(current["updated_at"]):
                            db.execute("""UPDATE formal_agent_skill_host_installations
                              SET skill_version=?,status=?,updated_at=? WHERE installation_id=?""",
                              (installation["skill_version"], installation["status"],
                               installation["updated_at"], current["installation_id"]))
                        db.execute("DELETE FROM formal_agent_skill_host_installations WHERE installation_id=?",
                                   (installation["installation_id"],))
                db.execute("UPDATE formal_agent_skill_host_invocations SET host_id=? WHERE host_id=?",
                           (keeper_id, duplicate_id))
                db.execute("UPDATE formal_agent_skill_host_audit SET host_id=? WHERE host_id=?",
                           (keeper_id, duplicate_id))
                try:
                    self.vault.delete(duplicate_id)
                except Exception:
                    # A missing or already-revoked encrypted envelope is not a
                    # reason to preserve a duplicate registry row.
                    pass
                db.execute("DELETE FROM formal_agent_skill_hosts WHERE host_id=?", (duplicate_id,))
                merged += 1
            if merged:
                self._audit(db, str(keeper["host_id"]), "deduplicate", "runtime-migration", "success",
                            detail={"merged_count": merged, "canonical_identity": "address_protocol"})

    def _validate_url(self, value: str) -> str:
        try:
            parsed = urlsplit(str(value))
            port = parsed.port
        except ValueError as exc:
            raise AgentSkillHostError("host_url_invalid") from exc
        hostname = (parsed.hostname or "").casefold()
        is_loopback = hostname in {"127.0.0.1", "localhost", "::1"}
        local_http = (self.allow_loopback_http and is_loopback
                      and parsed.scheme == "http" and port in self.loopback_ports)
        public_https = parsed.scheme == "https" and port in {None, 443}
        if ((not local_http and not public_https) or not hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment):
            raise AgentSkillHostError("host_url_invalid")
        if hostname not in self.allowed_hosts:
            raise AgentSkillHostError("host_url_not_allowed")
        try:
            addresses = {item[4][0] for item in self.dns_resolver(
                hostname, port or (8010 if local_http else 443), type=socket.SOCK_STREAM)}
        except OSError as exc:
            raise AgentSkillHostError("host_dns_resolution_failed") from exc
        if not addresses:
            raise AgentSkillHostError("host_dns_resolution_failed")
        for address in addresses:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
            if not ip.is_global and not (local_http and ip.is_loopback):
                raise AgentSkillHostError("host_address_not_allowed")
        normalized_path = "/" + "/".join(segment for segment in parsed.path.split("/") if segment)
        authority = hostname if port is None else f"{hostname}:{port}"
        return f"{parsed.scheme}://{authority}{'' if normalized_path == '/' else normalized_path}"

    def _host(self, db: sqlite3.Connection, host_id: str) -> sqlite3.Row:
        row = db.execute("SELECT * FROM formal_agent_skill_hosts WHERE host_id=? AND tenant_id=? AND workspace_id=?",
                         (host_id, *self.scope.sql_parameters())).fetchone()
        if not row:
            raise AgentSkillHostError("host_not_configured")
        return row

    def _audit(self, db: sqlite3.Connection, host_id: str | None, operation: str,
               operator_id: str, result: str, error_code: str | None = None,
               detail: Any | None = None, audit_id: str | None = None) -> str:
        audit_id = audit_id or f"FSHA-{uuid.uuid4()}"
        db.execute("""INSERT INTO formal_agent_skill_host_audit VALUES(?,?,?,?,?,?,?,?,?,?)""",
                   (audit_id,host_id,operation,operator_id,result,error_code,
                    _json(redact(detail or {})),_now(),*self.scope.sql_parameters()))
        return audit_id

    def _serialize(self, db: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        item["status"] = item.pop("connection_status")
        item["capabilities"] = json.loads(item.pop("capabilities_json") or "[]")
        item["last_test_result"] = json.loads(item.pop("last_test_result_json") or "null")
        item.pop("secret_ref", None)
        count = db.execute("""SELECT COUNT(*) FROM formal_agent_skill_host_installations
          WHERE host_id=? AND status='installed' AND tenant_id=? AND workspace_id=?""",
          (row["host_id"],*self.scope.sql_parameters())).fetchone()[0]
        item["installed_skill_count"] = count
        return item

    def create_host(self, *, host_name: str, host_type: str, base_url: str,
                    environment: str = "china_uat", protocol: str = "formal-agent-skill",
                    protocol_version: str = "1.0", auth_type: str = "none",
                    operator_id: str = "local_operator") -> dict[str, Any]:
        if not host_name.strip() or len(host_name) > 128 or protocol not in self.PROTOCOLS:
            raise AgentSkillHostError("host_input_invalid")
        safe_url = self._validate_url(base_url) if base_url.strip() else ""
        auth_type = self._auth_type(auth_type)
        if auth_type not in self.vault.SUPPORTED_AUTH:
            raise AgentSkillHostError("host_auth_type_invalid")
        host_id, now = f"FSH-{uuid.uuid4()}", _now()
        with self.connect() as db:
            db.execute("""INSERT INTO formal_agent_skill_hosts(
              host_id,host_name,host_type,base_url,enabled,connection_status,last_tested_at,
              tenant_id,workspace_id,environment,protocol,protocol_version,auth_type,secret_ref,
              credential_fingerprint,capabilities_json,last_test_result_json,last_invoked_at,created_at,updated_at)
              VALUES(?,?,?,?,0,?,NULL,?,?,?,?,?,?,NULL,NULL,'[]',NULL,NULL,?,?)""",
              (host_id,host_name.strip(),host_type,safe_url,
               "pending_test" if safe_url else "not_configured",*self.scope.sql_parameters(),environment,
               protocol,protocol_version,auth_type,now,now))
            self._audit(db,host_id,"create",operator_id,"success",detail={"base_url":safe_url})
            return self._serialize(db,self._host(db,host_id))

    def list_hosts(self) -> dict[str, Any]:
        with self.connect() as db:
            rows = db.execute("""SELECT * FROM formal_agent_skill_hosts WHERE tenant_id=? AND workspace_id=?
              ORDER BY created_at,host_name""",self.scope.sql_parameters()).fetchall()
            items = [self._serialize(db,row) for row in rows]
            return {"items":items,"count":len(items),
                    "connected_count":sum(item["status"]=="connected" and item["enabled"] for item in items),
                    "external_host_status":"connected" if any(item["status"]=="connected" for item in items)
                                           else ("pending_test" if items else "not_configured")}

    def get_host(self, host_id: str) -> dict[str, Any]:
        with self.connect() as db:
            return self._serialize(db,self._host(db,host_id))

    def update_host(self, host_id: str, *, operator_id: str = "local_operator", **changes: Any) -> dict[str, Any]:
        allowed = {"host_name","host_type","base_url","environment","protocol","protocol_version","auth_type"}
        if not changes or set(changes)-allowed:
            raise AgentSkillHostError("host_input_invalid")
        if "base_url" in changes:
            raw_url = str(changes["base_url"] or "")
            changes["base_url"] = self._validate_url(raw_url) if raw_url.strip() else ""
        if "protocol" in changes and changes["protocol"] not in self.PROTOCOLS:
            raise AgentSkillHostError("host_protocol_incompatible")
        if "auth_type" in changes and changes["auth_type"] not in self.vault.SUPPORTED_AUTH:
            changes["auth_type"] = self._auth_type(str(changes["auth_type"]))
            if changes["auth_type"] not in self.vault.SUPPORTED_AUTH:
                raise AgentSkillHostError("host_auth_type_invalid")
        with self.connect() as db:
            before = self._host(db,host_id)
            assignments = ",".join(f"{key}=?" for key in changes)
            next_status = "not_configured" if "base_url" in changes and not changes["base_url"] else "pending_test"
            db.execute(f"UPDATE formal_agent_skill_hosts SET {assignments},connection_status=?,enabled=0,updated_at=? WHERE host_id=? AND tenant_id=? AND workspace_id=?",
                       (*changes.values(),next_status,_now(),host_id,*self.scope.sql_parameters()))
            self._audit(db,host_id,"update",operator_id,"success",detail={"fields":sorted(changes)})
            return self._serialize(db,self._host(db,host_id))

    def set_credentials(self, host_id: str, credential: str | dict[str, Any] | None, *,
                        auth_type: str | None = None, operator_id: str = "local_operator") -> dict[str, Any]:
        with self.connect() as db:
            host = self._host(db,host_id)
            selected = self._auth_type(auth_type or host["auth_type"])
            metadata = self.vault.save(host_id,selected,credential)
            db.execute("""UPDATE formal_agent_skill_hosts SET auth_type=?,secret_ref=?,credential_fingerprint=?,
              connection_status='pending_test',enabled=0,updated_at=? WHERE host_id=? AND tenant_id=? AND workspace_id=?""",
              (selected,metadata.secret_ref or None,metadata.credential_fingerprint or None,_now(),host_id,*self.scope.sql_parameters()))
            self._audit(db,host_id,"credential_rotate",operator_id,"success",
                        detail={"credential_fingerprint":metadata.credential_fingerprint})
            return self._serialize(db,self._host(db,host_id))

    def revoke_credentials(self, host_id: str, *, operator_id: str = "local_operator") -> dict[str, Any]:
        with self.connect() as db:
            self._host(db,host_id)
            self.vault.delete(host_id)
            db.execute("""UPDATE formal_agent_skill_hosts SET secret_ref=NULL,credential_fingerprint=NULL,
              connection_status='pending_test',enabled=0,updated_at=? WHERE host_id=? AND tenant_id=? AND workspace_id=?""",
              (_now(),host_id,*self.scope.sql_parameters()))
            self._audit(db,host_id,"credential_revoke",operator_id,"success")
            return self._serialize(db,self._host(db,host_id))

    def _headers(self, host: sqlite3.Row) -> dict[str, str]:
        auth_type = host["auth_type"]
        headers = {"Accept":"application/json","User-Agent":"IntelligentChannelScheduler/1"}
        if auth_type == "none": return headers
        resolved_type, values = self.vault.load(host["host_id"],host["secret_ref"])
        if resolved_type != auth_type: raise AgentSkillHostError("host_authentication_failed")
        if auth_type == "bearer": headers["Authorization"] = "Bearer " + values["secret"]
        elif auth_type == "api_key_header":
            name = values.get("header_name","X-API-Key")
            if name.casefold() in {"host","content-length","connection","cookie","proxy-authorization"}:
                raise AgentSkillHostError("host_authentication_failed")
            headers[name] = values["secret"]
        else:
            # Token acquisition is intentionally delegated to a transport that
            # supports OAuth without exposing the client secret to callers.
            headers["X-Host-OAuth-Credential"] = "vault-managed"
        return headers

    def _request(self, host: sqlite3.Row, method: str, suffix: str, body: Any | None) -> HostTransportResponse:
        if not self.transport: raise AgentSkillHostError("host_connection_failed")
        base = self._validate_url(host["base_url"])
        url = base.rstrip("/") + "/" + suffix.lstrip("/")
        started = time.monotonic()
        try:
            response = self.transport.request(method=method,url=url,headers=self._headers(host),json…51678 tokens truncated…uest))
@app.post("/api/v1/uat/estimate-cost")
def estimate_uat_cost(body:dict[str,Any]):
    request=body.get("request",body)
    return estimate_cost(request.get("messages",[]),int(request.get("max_tokens") or 0))
@app.post("/api/v1/uat/execute")
def execute_uat_request(body:dict[str,Any],request:Request):
    settings,source,sid,_=_resolved(request)
    valid=(lambda: _persistent_credential(request) is not None) if source=="windows_encrypted_vault" else \
      ((lambda: SESSION_CREDENTIALS.metadata(sid) is not None) if source=="session" else None)
    channel=str((body.get("request") or {}).get("channel_id") or "unified-routing")
    catalog=executable_model_catalog(settings,request,channel)
    constraints=_uat_runtime_constraints(request)
    check=validate_uat(body,settings,current_uat_store(),catalog,constraints)
    if not check["valid"]:
      raise HTTPException(403,detail={"code":check["blocking_reasons"][0],"message":"真实 UAT 执行被安全策略阻止。","details":{"validation":check}})
    control=current_uat_execution_control(request)
    try:reservation=control.reserve(
      str(body["request"]["requested_model"]),channel,
      Decimal(str(check["cost_estimate"]["estimated_cost_cny"])))
    except UatExecutionControlError as exc:
      raise HTTPException(403,detail={"code":str(exc),"message":"受控真实执行额度不可用。"}) from exc
    try:
      result=execute_uat(body,settings,current_uat_store(),build_uat_shadow,UAT_TRANSPORT,
        source,valid,catalog,constraints,current_call_logs(request))
    finally:
      control.complete(reservation["reservation_id"],"completed")
    if not result["validation"]["valid"]:
      raise HTTPException(403,detail={"code":result["validation"]["blocking_reasons"][0],"message":"真实 UAT 执行被安全策略阻止。","details":result})
    return result
@app.post("/api/v1/environments/{environment_id}/execute")
def execute_environment_request(environment_id:str,body:dict[str,Any],request:Request):
    if not load_platform_environments().get(environment_id):
      raise HTTPException(404,detail={"code":"environment_not_supported","message":"Environment is not supported."})
    settings,source,sid,_=_resolved(request,environment_id)
    valid=(lambda: _persistent_credential(request,environment_id) is not None) if source=="windows_encrypted_vault" else \
      ((lambda: SESSION_CREDENTIALS.metadata(sid,environment_id=environment_id) is not None) if source=="session" else None)
    ids=MODEL_CATALOG.model_ids(settings.api_key,environment_id)
    channel=str((body.get("request") or {}).get("channel_id") or "unified-routing")
    capabilities=uat_model_capabilities(request,channel)
    catalog=None if ids is None else {x:capabilities.get(x,{
      "confirmed_max_output_tokens":None,"confirmed_channel_max_output_tokens":None,
      "evidence_source":"pending_confirmation"}) for x in ids}
    reservation=None
    if environment_id=="china_uat":
      constraints=_uat_runtime_constraints(request)
      check=validate_uat(body,settings,current_uat_store(),catalog,constraints)
      if not check["valid"]:
        raise HTTPException(403,detail={"code":check["blocking_reasons"][0],
          "message":"Real API execution was blocked by environment-aware safety policy.",
          "details":{"validation":check}})
      try:
        reservation=current_uat_execution_control(request).reserve(
          str(body["request"]["requested_model"]),channel,
          Decimal(str(check["cost_estimate"]["estimated_cost_cny"])))
      except UatExecutionControlError as exc:
        raise HTTPException(403,detail={"code":str(exc),
          "message":"Controlled UAT execution capacity is unavailable."}) from exc
    try:
      result=execute_uat(body,settings,current_uat_store(),build_uat_shadow,UAT_TRANSPORT,
        source,valid,catalog,constraints if environment_id=="china_uat" else None,
        current_call_logs(request))
    finally:
      if reservation is not None:
        current_uat_execution_control(request).complete(
          reservation["reservation_id"],"completed")
    if not result["validation"]["valid"]:
      raise HTTPException(403,detail={"code":result["validation"]["blocking_reasons"][0],
        "message":"Real API execution was blocked by environment-aware safety policy.","details":result})
    return result
@app.get("/api/v1/uat/executions")
def list_uat_executions(): return {"items":current_uat_store().list()}
@app.get("/api/v1/call-logs")
def list_call_logs(request:Request,after_cursor:int=Query(0,ge=0),
                   limit:int=Query(100,ge=1,le=1000),
                   environment_id:str|None=Query(None),
                   source_type:str|None=Query(None)):
    return current_call_logs(request).list_records(
      after_cursor=after_cursor,limit=limit,environment_id=environment_id,
      source_type=source_type)
@app.get("/api/v1/call-logs/analytics")
def call_log_analytics(request:Request,environment_id:str=Query("china_uat"),
                       model:str|None=Query(None),source_type:str|None=Query(None),
                       channel_id:str|None=Query(None),provider:str|None=Query(None),
                       request_status:str|None=Query(None),stream:bool|None=Query(None),
                       occurred_from:str|None=Query(None),occurred_to:str|None=Query(None),
                       traffic_class:str=Query("business",pattern="^(business|probe|all)$")):
    return current_call_logs(request).analytics(
        environment_id=environment_id,model=model,source_type=source_type,
        channel_id=channel_id,provider=provider,request_status=request_status,
        stream=stream,occurred_from=occurred_from,occurred_to=occurred_to,
        traffic_class=traffic_class)
@app.get("/api/v1/observability/overview")
def observability_overview(
    request:Request,environment_id:str=Query("china_uat"),
    time_range:str=Query("24h",pattern="^(5m|1h|24h|7d|custom)$"),
    start:str|None=Query(None),end:str|None=Query(None),
    traffic_class:str=Query("business",pattern="^(business|probe|all)$"),
    model_id:str|None=Query(None),stream:bool|None=Query(None),
    source_type:str=Query("all",pattern="^(historical|realtime|all)$")):
    try:
        return ObservabilityOverviewService(current_call_logs(request)).overview(
          environment_id=environment_id,time_range=time_range,start=start,end=end,
          traffic_class=traffic_class,model_id=model_id,stream=stream,
          source_type=source_type,circuits=current_circuit_breakers().list_states(limit=20))
    except ValueError as exc:
        raise HTTPException(400,detail={"code":str(exc)}) from exc
@app.get("/api/v1/call-logs/import-status")
def call_log_import_status(request:Request):
    report=current_call_logs(request).latest_import_report()
    return {"status":"ready" if report else "not_initialized","report":report}
@app.get("/api/v1/routing-decisions")
def list_routing_decisions(request:Request,request_id:str|None=Query(None),
                           limit:int=Query(100,ge=1,le=500)):
    return current_call_logs(request).list_routing_decisions(
      request_id=request_id,limit=limit)
@app.get("/api/v1/routing-decisions/{decision_id}")
def get_routing_decision(decision_id:str,request:Request):
    item=current_call_logs(request).routing_decision(decision_id)
    if not item:
      raise HTTPException(404,detail={"code":"ROUTING_DECISION_NOT_FOUND",
        "message":"未找到对应的真实调度决策。"})
    return item
@app.get("/api/v1/environments/{environment_id}/executions")
def list_environment_executions(environment_id:str):
    if not load_platform_environments().get(environment_id):
      raise HTTPException(404,detail={"code":"environment_not_supported","message":"Environment is not supported."})
    return {"environment_id":environment_id,"items":current_uat_store().list(environment_id)}
@app.get("/api/v1/uat/executions/{execution_id}")
def get_uat_execution(execution_id:str):
    item=current_uat_store().get(execution_id)
    if not item: raise HTTPException(404,detail={"code":"NOT_FOUND","message":"execution not found"})
    return item
@app.get("/api/v1/uat/progress")
def uat_progress():
    store=current_uat_store();items=store.list()
    return {"execution_count":len(items),"requests_used_today":store.usage_today()[0],"genuine_imported_record_count":sum(1 for r in STORE.records() if r.get("source_type") in {"measured_uat","measured_unified_uat","backend_log_export"})}
@app.post("/api/v1/uat/executions/{execution_id}/attach-backend-evidence")
def attach_backend_evidence(execution_id:str,body:dict[str,Any]):
    store=current_uat_store();item=store.get(execution_id)
    if not item: raise HTTPException(404,detail={"code":"NOT_FOUND","message":"execution not found"})
    logs=[r for r in STORE.records() if r.get("source_type")=="backend_log_export"]
    result=correlate(item,logs,str(body.get("platform_log_id") or "") or None)
    store.save_correlation(result)
    return result
@app.post("/api/v1/uat/executions/{execution_id}/confirm-correlation")
def confirm_uat_correlation(execution_id:str,body:dict[str,Any]):
    store=current_uat_store();item=store.get(execution_id)
    if not item or not item.get("correlation"): raise HTTPException(409,detail={"code":"CORRELATION_NOT_READY","message":"correlation must be attached first"})
    result={**item["correlation"],"correlation_status":"manually_confirmed","human_confirmed":True,
      "confirmed_by":str(body.get("confirmed_by") or "operator"),"confirmed_at":datetime.now(timezone.utc).isoformat()}
    store.save_correlation(result)
    return result
@app.get("/api/v1/overview")
def overview(request:Request,mode:str=Query("uat"),environment_id:str=Query("china_uat"),
             time_range:str=Query("all",pattern="^(24h|7d|30d|all)$")):
    if mode=="uat":
      selected_environment=environment_id if environment_id in {"china_uat","overseas"} else "china_uat"
      range_days={"24h":1,"7d":7,"30d":30}
      occurred_from=(datetime.now(timezone.utc)-timedelta(
        days=range_days[time_range])).isoformat() if time_range in range_days else None
      snapshot=current_call_logs(request).overview_snapshot(
        selected_environment,occurred_from=occurred_from)
      principal=request_principal(request)
      saved=current_runtime_settings().execution_state(
        selected_environment,principal=principal) if selected_environment=="china_uat" else None
      configured_enabled=UatSettings.load(selected_environment).enabled
      environment_enabled=(saved or {}).get("enabled",configured_enabled)
      try:
        settings,credential_source,_,credential_meta=_resolved(
          request,selected_environment)
        credential_meta=credential_meta or {}
        credential_configured=bool(settings.api_key)
      except Exception:
        credential_source="none";credential_meta={};credential_configured=False
      connection_status="not_tested"
      if selected_environment=="china_uat":
        try:
          sid,key,temp_meta,auth_session_id=_temporary_workbench_credential(
            request,selected_environment)
          fingerprint=(temp_meta or {}).get("key_fingerprint")
          if key and fingerprint and WORKBENCH_CONNECTIONS.verified(
              sid,selected_environment,str(fingerprint),str(auth_session_id or "")):
            connection_status="success"
          elif key:
            connection_status="not_tested"
        except Exception:
          pass
      blockers=[]
      if not environment_enabled: blockers.append({
        "code":"real_execution_disabled","message":"UAT 环境当前已关闭，请打开 UAT 环境后再执行。",
        "action_path":"/routing/execute"})
      if not credential_configured: blockers.append({
        "code":"credential_missing","message":"尚未提供可用于真实执行的 API Key。",
        "action_path":"/routing/execute?tab=auth"})
      elif connection_status!="success": blockers.append({
        "code":"connection_not_verified","message":"API Key 尚未完成当前会话的连接测试。",
        "action_path":"/routing/execute?tab=auth"})
      metrics=snapshot["metrics"]
      return {**snapshot,
        "mode":"uat","time_range":time_range,"records":metrics["request_count"],
        "sample_size":metrics["request_count"],
        "channel_summary":snapshot["channels"],"channels":len(snapshot["channels"]),
        "errors":metrics["failure_count"],
        "healthy":sum(item["success_rate"]>=.95 for item in snapshot["channels"]),
        "routing_distribution":{
          item["channel_id"]:item["request_count"] for item in snapshot["channels"]},
        "budget":{"today_uat_spend":metrics["today_cost"],"remaining_budget":None},
        "last_updated":snapshot["data_as_of"],"updated_at":snapshot["data_as_of"],
        "warnings":[item["code"] for item in blockers],"blockers":blockers,
        "runtime":{
          "environment_enabled":environment_enabled,
          "environment_state_source":(saved or {}).get("state_source","environment_configuration"),
          "credential_configured":credential_configured,
          "credential_source":credential_source,
          "credential_fingerprint":credential_meta.get("key_fingerprint"),
          "connection_status":connection_status,
          "log_sync_status":"synchronized" if snapshot["last_synced_at"] else "never_synchronized",
          "freshness_status":"available" if snapshot["last_synced_at"] else
            ("historical_only" if snapshot["data_as_of"] else "no_data"),
        },
        "evidence_id":hashlib.sha256(json.dumps({
          "environment_id":selected_environment,"data_as_of":snapshot["data_as_of"],
          "records":metrics["request_count"]},sort_keys=True).encode()).hexdigest(),
        "collection_ids":[],"configuration_version":"overview_real_evidence_v1",
        "currency":metrics["currency"],
        "limitations":[snapshot["channel_evidence_note"]],
      }
    rows=records_for(mode,environment_id)
    cards=health(rows) if mode=="demo" else uat_health(rows)
    explicit_environment=environment_id if environment_id in {"demo","china_uat","overseas"} else None
    meta=analytical_metadata(mode,environment_id,rows,
      ["汇总仅代表当前筛选范围内已载入的结构化证据。"],
      configuration_version="routing-console-analytics-v1")
    return {**meta,"data_mode":"mock","data_as_of":meta["updated_at"],
      "last_synced_at":meta["updated_at"],
      "records":len(rows),"channels":len(cards),"healthy":sum(x.get("health_state")=="healthy" for x in cards),
      "errors":sum(x.get("result")=="failure" for x in rows),
      "budget":budget(rows,environment_id=explicit_environment),
      "routing_distribution":dict(Counter(x.get("channel_id","") for x in rows if x.get("channel_id"))),
      "last_updated":meta["updated_at"],
      "warnings":[] if rows else ["尚未导入UAT证据，请先前往数据导入页面。"]}
@app.post("/api/v1/imports/preview")
async def preview(file:UploadFile=File(...),mapping:str|None=Form(None),source_type:str=Form("measured_uat"),environment_id:str=Form("china_uat")):
    return await process_upload(file,mapping,source_type,environment_id)
@app.post("/api/v1/imports/validate")
async def validate_import(file:UploadFile=File(...),mapping:str|None=Form(None),source_type:str=Form("measured_uat"),environment_id:str=Form("china_uat")):
    return await process_upload(file,mapping,source_type,environment_id)
@app.post("/api/v1/imports/confirm")
async def confirm(file:UploadFile=File(...),mapping:str|None=Form(None),source_type:str=Form("measured_uat"),environment_id:str=Form("china_uat")):
    batch=await process_upload(file,mapping,source_type,environment_id)
    try:STORE.save_batch(batch)
    except Exception as exc:
      raise HTTPException(409,detail={"code":"BATCH_EXISTS","message":str(exc)})
    current_call_logs().import_normalized_rows(
      batch.get("normalized_rows",[]),environment_id=environment_id,
      source_type=source_type,import_batch_id=batch["batch_id"])
    return batch
@app.get("/api/v1/imports")
def imports(): return {"items":STORE.batches()}
@app.get("/api/v1/imports/{batch_id}/quality-report",response_class=PlainTextResponse)
def quality_report(batch_id:str):
    batch=next((item for item in STORE.batches() if item["batch_id"]==batch_id),None)
    if not batch:raise HTTPException(404,detail={"code":"NOT_FOUND","message":"import batch not found"})
    lines=[f"# Data Quality Report — {batch_id}","",f"- Source: {batch['source_type']}",f"- SHA-256: {batch['source_sha256']}",
      f"- Rows: {batch['row_count']}",f"- Valid: {batch['valid_count']}",f"- Warnings: {batch['warning_count']}",
      f"- Rejected: {batch['rejected_count']}",f"- Needs confirmation: {batch['needs_confirmation_count']}","",
      "## Issues",*(f"- Row {issue['row']}: {issue['code']}" for issue in batch["issues"])]
    return "\n".join(lines)
@app.get("/api/v1/health/channels")
def channels(mode:str=Query("demo"),environment_id:str=Query("all")):
    rows=records_for(mode,environment_id)
    meta=analytical_metadata(mode,environment_id,rows,
      ["健康度只基于当前样本；小样本不会被描述为稳定健康。"],
      configuration_version="health-window-v1")
    return {**meta,"last_updated":meta["updated_at"],
      "items":health(rows) if mode=="demo" else uat_health(rows)}
@app.get("/api/v1/health/channels/{channel_id}")
def channel(channel_id:str,mode:str=Query("demo")):
    items=channels(mode)["items"]; item=next((x for x in items if x["channel_id"]==channel_id),None)
    if not item:raise HTTPException(404,detail={"code":"NOT_FOUND","message":"渠道不存在"})
    return item
@app.get("/api/v1/shadow/summary")
def shadow_summary(mode:str=Query("demo")):
    if mode=="uat":
      store=current_uat_store();executions=[store.get(x["execution_id"]) for x in store.list()]
      correlated=[x for x in executions if x and x.get("correlation")]
      return {**analytical_metadata("uat","all",[],
          ["缺少关联时，实际渠道只能等待已导入的后端日志；未执行渠道没有反事实结果。"],
          source_type="measured_unified_uat" if executions else None,
          configuration_version="decision-policy-v1.0.0"),
        "agreement_rate":None,"routing_concentration_hhi":None,"counterfactual_available":False,
        "sample_size":len(executions),"source_type":"measured_unified_uat" if executions else None,
        "items":[{"execution_id":x["execution_id"],"local_scheduler_recommendation":(x.get("shadow_decision") or {}).get("recommended_candidate"),
          "platform_actual_channel":x["correlation"].get("platform_actual_channel"),"correlation_status":x["correlation"].get("correlation_status"),
          "recommendation_matches_actual":(x.get("shadow_decision") or {}).get("recommended_candidate")==x["correlation"].get("platform_actual_channel"),
          "decision_limitations":["不一致不自动代表错误；平台私有规则未知。"]} for x in correlated],
        "limitation":"缺少关联时，实际渠道只能等待已导入的后端日志；未执行渠道没有反事实结果。"}
    rows=records_for("demo")
    return {**analytical_metadata("demo","all",rows,
      ["未执行渠道的反事实性能不可用。"],configuration_version="decision-policy-v1.0.0"),
      "agreement_rate":.6,"routing_concentration_hhi":.2,"counterfactual_available":False,
      "sample_size":5,"source_type":"demo_mock","limitation":"未执行渠道的反事实性能不可用。"}
@app.get("/api/v1/shadow/decisions")
def shadow_decisions(mode:str=Query("demo")):
    if mode=="uat":return {"items":[],"blocker":"missing_pre_execution_shadow_decision_linkage"}
    return {"items":[{"shadow_decision_id":"SD-001","request_id":"D002","shadow_recommended_channel":"19","platform_actual_channel":"27","recommendation_matches_actual":False,"execution_attempted_by_scheduler":False,"counterfactual_outcome_available":False}]}
@app.get("/api/v1/historical-replay/source")
def historical_replay_source(request:Request,environment_id:str="china_uat",
    occurred_from:str|None=None,occurred_to:str|None=None,model:str|None=None,
    channel:str|None=None,request_type:str|None=None,exact_only:bool=False):
    return current_historical_replay(request).source_summary({
      "environment_id":environment_id,"occurred_from":occurred_from,
      "occurred_to":occurred_to,"model":model,"channel":channel,
      "request_type":request_type,"exact_only":exact_only})
@app.post("/api/v1/historical-replay/runs")
def run_historical_replay(body:HistoricalReplayIn,request:Request):
    try:
      return current_historical_replay(request).run(
        baseline_strategy=body.baseline_strategy,
        candidate_strategy=body.candidate_strategy,
        filters={key:value for key,value in body.model_dump().items()
          if key not in {"baseline_strategy","candidate_strategy","limit"}},
        limit=body.limit)
    except HistoricalReplayError as exc:
      raise HTTPException(400,detail={"code":str(exc),
        "message":"历史回放请求未通过确定性校验。"}) from exc
@app.get("/api/v1/historical-replay/runs/{replay_id}")
def get_historical_replay(replay_id:str,request:Request):
    try:return current_historical_replay(request).get(replay_id)
    except HistoricalReplayError as exc:
      raise HTTPException(404,detail={"code":str(exc),"message":"历史回放不存在。"}) from exc
@app.get("/api/v1/historical-replay/runs/{replay_id}/export.csv")
def export_historical_replay(replay_id:str,request:Request):
    try:content=current_historical_replay(request).export_csv(replay_id)
    except HistoricalReplayError as exc:
      raise HTTPException(404,detail={"code":str(exc),"message":"历史回放不存在。"}) from exc
    return Response(content=content,media_type="text/csv; charset=utf-8",
      headers={"Content-Disposition":f'attachment; filename="{replay_id}.csv"'})
@app.post("/api/v1/replay/run")
def run_replay(body:ReplayIn):
    rows=records_for(body.mode,body.environment_id)
    result=replay(body.strategy,rows)
    return {**result,**analytical_metadata(
      body.mode,body.environment_id,rows,
      ["离线重放不会调用模型 API。","缺少候选快照或实际字段时，相应比较值保持 null。"],
      source_type="offline_replay",configuration_version="decision-policy-v1.0.0"),
      "is_mock":body.mode=="demo",
      "input_sample_size":len(rows),
      "eligible_sample_size":sum(bool(row.get("channel_id")) for row in rows),
      "limitations":["离线重放不会调用模型 API。",
        "缺少候选快照或实际字段时，相应比较值保持 null。"],
      "catalog_version":None,"catalog_sha256":None,
      "policy_version":"decision-policy-v1.0.0",
      "created_at":datetime.now(timezone.utc).isoformat()}
@app.get("/api/v1/replay/{replay_id}")
def get_replay(replay_id:str,mode:str=Query("demo"),environment_id:str=Query("all")):
    return {**replay("confidence_aware_v2",records_for(mode,environment_id)),
      "replay_id":replay_id,"environment_id":environment_id,"source_type":"offline_replay"}
@app.get("/api/v1/errors")
def errors(request:Request,mode:str=Query("demo"),environment_id:str=Query("all")):
    """Return failures from the authoritative standardized call ledger.

    The operations UI must not fall back to the legacy demo collection when it
    is in UAT mode.  Only redacted identifiers and normalized error metadata are
    projected; request/response bodies and credentials never enter this view.
    """
    if mode == "demo":
        rows=records_for(mode,environment_id)
        return {**analytical_metadata(mode,environment_id,rows,
          ["演示模式仅用于开发回归，不属于真实 UAT 验收。"],
          configuration_version="error-taxonomy-v1"),
          "items":[{**classify(r.get("http_status"),"imported failure"),
            "error_id":"ERR-"+r.get("request_id","unknown"),
            "request_id":r.get("request_id","") or None,
            "channel_id":r.get("channel_id","") or None}
            for r in rows if r.get("result")=="failure"]}
    ledger=current_call_logs(request).list_records(
        limit=1000,environment_id=None if environment_id=="all" else environment_id)
    failed=[row for row in ledger["items"] if row.get("request_status") in {
        "FAILED","TIMEOUT","INTERRUPTED"}]
    actions={
      "timeout":"检查上游响应时间与超时设置后再决定是否有限重试。",
      "rate_limit":"等待限流窗口恢复后再执行有限重试。",
      "authentication":"检查当前 UAT API Key，禁止自动重试。",
      "cancelled":"用户已停止请求；保留已接收内容，不自动重试。",
      "protocol_error":"检查上游响应协议和流式兼容性。",
      "uat_transport_failed":"检查国内 UAT 网络或上游服务状态。",
    }
    items=[]
    for row in failed:
        category=str(row.get("error_category") or row.get("error_code") or "unknown_failure")
        status=row.get("http_status")
        layer=("historical_evidence" if row.get("is_historical") else
               "upstream" if status is not None else "transport")
        items.append({
          "error_id":f"ERR-{row['record_id']}","record_id":row["record_id"],
          "request_id":row.get("request_id"),"decision_id":row.get("decision_id"),
          "channel_id":row.get("channel_id"),"model":row.get("requested_model"),
          "error_category":category,"error_layer":layer,
          "request_status":row.get("request_status"),"http_status":status,
          "retryable":bool(row.get("retryable")),"fallback_allowed":False,
          "recommended_action":actions.get(category,"查看脱敏错误和关联执行记录后处理。"),
          "occurred_at":row.get("occurred_at"),"source_type":row.get("source_type"),
        })
    return {
      "mode":"uat","environment_id":environment_id,"source_type":"standardized_call_logs",
      "is_mock":False,"sample_size":len(items),"updated_at":ledger.get("updated_at"),
      "configuration_version":"error-taxonomy-v2","items":items,
      "limitations":["只展示标准化脱敏错误字段；不包含请求正文、响应正文或凭据。"],
    }
@app.get("/api/v1/errors/{error_id}")
def error(error_id:str): return {**classify(429,"rate limited"),"error_id":error_id}
@app.post("/api/v1/bugs/generate")
def bugs(body:BugIn): return bug_report(body.model_dump())
@app.get("/api/v1/budgets/summary")
def budgets(request:Request,mode:str=Query("demo"),environment_id:str=Query("all")):
    if mode=="uat" and environment_id!="overseas":
      target_environment="china_uat" if environment_id=="all" else environment_id
      unified=current_call_logs(request).cost_records(environment_id=target_environment)
      rows=[{
        "record_id":row.get("record_id"),"request_id":row.get("request_id"),
        "timestamp":row.get("occurred_at"),"environment_id":target_environment,
        "channel_id":row.get("channel_id"),"channel_name":row.get("channel_name"),
        "requested_model":row.get("requested_model"),"actual_model":row.get("actual_model"),
        "result":"success" if str(row.get("request_status") or "").upper()=="SUCCESS" else "failure",
        "http_status":row.get("http_status"),"latency_ms":row.get("total_latency_ms"),
        "input_tokens":row.get("input_tokens"),"cached_input_tokens":row.get("cached_input_tokens"),
        "output_tokens":row.get("output_tokens"),
        "total_tokens":sum(int(row.get(field) or 0) for field in
          ("input_tokens","cached_input_tokens","output_tokens")),
        "cost_cny":row.get("cost_amount") if row.get("currency") in (None,"CNY") else None,
        "source_type":row.get("source_type"),"price_version":row.get("price_version"),
        "cost_source":row.get("cost_source"),
      } for row in unified]
    else:
      rows=records_for(mode,environment_id)
    explicit_environment=environment_id if environment_id in {"demo","china_uat","overseas"} else None
    result={**budget(rows,environment_id=explicit_environment),"mode":mode,"environment_id":environment_id,
      "source_type":"demo_mock" if mode=="demo" else (rows[0].get("source_type") if rows else None),
      "sample_size":len(rows)}
    result["currency"]=result.get("summary",{}).get("currency")
    if environment_id=="overseas":
      result["currency"]=None
      result["summary"]["currency"]=None
      result["limitations"]=["费用币种待确认；未进行跨币种汇总或换算。"]
    meta=analytical_metadata(
      mode,environment_id,rows,result.get("limitations",[]),
      configuration_version=result.get("policy_version"),currency=result["currency"])
    result.update({key:meta[key] for key in (
      "is_mock","evidence_id","collection_ids","updated_at","configuration_version")})
    return result
@app.get("/api/v1/mappings")
def mapping(mode:str=Query("demo"),environment_id:str=Query("all")):
    rows=records_for(mode,environment_id)
    return {**analytical_metadata(mode,environment_id,rows,
      ["实际模型缺失时保持待确认，不从请求模型推断。"],
      configuration_version="model-mapping-v1"),
      "items":mappings([r for r in rows if r.get("channel_id") and r.get("requested_model")])}
@app.get("/api/v1/compatibility")
def compat(mode:str=Query("demo"),environment_id:str=Query("all")):
    rows=records_for(mode,environment_id)
    meta=analytical_metadata(mode,environment_id,rows,
      ["Only explicit compatibility evidence can produce passed or failed."],
      configuration_version="compatibility-evidence-v1")
    if mode=="uat" and not rows:return {**meta,"execution_mode":"definition_only","items":[]}
    return {**meta,"execution_mode":"evidence_only",
      "items":compatibility(rows)}
@app.get("/api/v1/config-review")
def review_current_configuration(request:Request,environment_id:str=Query("china_uat"),
                                 baseline_version:str|None=Query(None),
                                 comparison_version:str|None=Query(None)):
    if environment_id != "china_uat":
      raise HTTPException(400,detail={"code":"CONFIG_REVIEW_ENVIRONMENT_UNSUPPORTED",
        "message":"配置评审仅使用国内 UAT 真实数据。"})
    return current_config_review(request).review(environment_id,baseline_version,comparison_version)

@app.get("/api/v1/config-review/versions")
def config_review_versions(request:Request):
    return {"status":"ready","items":current_config_review(request).versions()}

@app.post("/api/v1/config-review/versions")
def create_config_review_version(body:dict[str,Any],request:Request):
    _secure_credential_request(request)
    principal=request_principal(request)
    try:
      return current_config_review(request).create_version(
        base_version=str(body.get("base_version") or ""),
        patch=body.get("patch") if isinstance(body.get("patch"),dict) else {},
        created_by=principal.principal_id,
        change_reason=str(body.get("change_reason") or ""))
    except ValueError as exc:
      raise HTTPException(409,detail={"code":str(exc),"message":"配置版本创建失败。"}) from exc

@app.post("/api/v1/config-review/versions/{target_version}/rollback")
def rollback_config_review_version(target_version:str,body:dict[str,Any],request:Request):
    _secure_credential_request(request)
    principal=request_principal(request)
    try:
      return current_config_review(request).rollback(
        target_version=target_version,active_version=str(body.get("active_version") or ""),
        created_by=principal.principal_id,change_reason=str(body.get("change_reason") or ""))
    except ValueError as exc:
      raise HTTPException(409,detail={"code":str(exc),"message":"配置回滚失败。"}) from exc

@app.post("/api/v1/config-review")
def review_current_configuration_compat(body:ConfigIn,request:Request):
    """Compatibility route; client-provided weights never replace persisted policy."""
    environment_id=body.environment_id if body.environment_id=="china_uat" else "china_uat"
    return current_config_review(request).review(environment_id)
@app.get("/api/v1/exports")
def exports(mode:str=Query("demo"),environment_id:str=Query("all")):
    rows=records_for(mode,environment_id)
    return {**analytical_metadata(mode,environment_id,rows,
      ["报告只导出当前筛选范围内的脱敏结构化证据。"],
      configuration_version="report-catalog-v1"),
      "items":[{"name":name,"format":fmt} for name,fmt in EXPORT_REPORT_NAMES.items()]}
@app.post("/api/v1/exports/generate")
def generate_export(body:ExportIn,request:Request):
    if body.name not in EXPORT_REPORT_NAMES:
      raise HTTPException(404,detail={"code":"UNKNOWN_REPORT","message":f"未知报告名称：{body.name}"})
    generated_at=datetime.now(timezone.utc).isoformat()
    fmt=EXPORT_REPORT_NAMES[body.name]
    if body.name=="渠道健康报告":
      data=channels(body.mode,body.environment_id)
      lines=[f"# {body.name}","",f"生成时间：{generated_at}",f"样本：{data['sample_size']}",f"数据来源：{data.get('source_type') or '待确认'}","",
        "| 渠道 | 样本 | 成功率 | P50 延迟 | P95 延迟 | 状态 |","|---|---:|---:|---:|---:|---|"]
      lines += [f"| {item.get('channel_name') or item.get('channel_id') or '待确认'} | {item.get('sample_size',0)} | {item.get('observed_success_rate','待确认')} | {item.get('p50_latency','待确认')} | {item.get('p95_latency','待确认')} | {item.get('health_state') or '待确认'} |" for item in data["items"]]
      if not data["items"]: lines.append("| 暂无可用记录 | 0 | 待确认 | 待确认 | 待确认 | 证据不足 |")
      content="\n".join(lines)
    elif body.name=="影子调度报告":
      data=shadow_summary(body.mode)
      lines=[f"# {body.name}","",f"生成时间：{generated_at}",f"样本：{data.get('sample_size',0)}",f"数据来源：{data.get('source_type') or '待确认'}","",
        "## 观察摘要","",f"- 决策数量：{data.get('decision_count',data.get('sample_size',0))}",f"- 平台实际渠道：仅在存在后台日志证据时展示",f"- 离线推荐：不代表平台实际路由","",
        "## 限制","",*(f"- {item}" for item in data.get("limitations",["当前证据不足以确认平台实际渠道。"]))]
      content="\n".join(lines)
    elif body.name=="错误报告":
      data=errors(request,body.mode,body.environment_id)
      lines=[f"# {body.name}","",f"生成时间：{generated_at}",f"样本：{data['sample_size']}",f"数据来源：{data.get('source_type') or '未知'}",""]
      lines+=[f"- {item['error_id']}：{item['error_category']}（{item['error_layer']}）· 请求 {item['request_id']} · 渠道 {item['channel_id'] or '未知'} · 建议：{item['recommended_action']}" for item in data["items"]]
      if not data["items"]: lines.append("当前范围没有错误记录。")
      content="\n".join(lines)
    else:
      rows=records_for(body.mode,body.environment_id)
      lines=[f"# {body.name}","",f"生成时间：{generated_at}","说明：清单仅列出脱敏证据引用，不包含密钥、鉴权头或完整提示词。","",
        "| 请求 ID | 证据引用 |","|---|---|"]
      lines += [f"| {r.get('request_id') or '待确认'} | {safe_ref(r.get('request_id') or 'unknown')} |" for r in rows]
      if not rows: lines.append("| 暂无记录 | 待确认 |")
      content="\n".join(lines)
    return {"name":body.name,"format":fmt,"generated_at":generated_at,
      "sha256":hashlib.sha256(content.encode("utf-8")).hexdigest(),"content":content}

@app.post("/api/v1/security/session/bootstrap")
def enterprise_session_bootstrap(request:Request,response:Response):
    """Create only the explicit loopback development bootstrap session."""
    try:
      token,validation,csrf_token=ENTERPRISE_HTTP.bootstrap_development(request)
    except EnterpriseHTTPError as exc:
      raise HTTPException(exc.status_code,detail={"code":exc.code}) from exc
    set_session_cookie(response,token,INGRESS_PROFILE)
    principal=validation.principal
    return {
      "status":"authenticated",
      "principal":{
        "principal_id":principal.principal_id,
        "principal_type":principal.principal_type.value,
        "tenant_id":principal.tenant_id,
        "workspace_id":principal.workspace_id,
        "roles":sorted(principal.roles),
        "authn_method":principal.authn_method,
        "expires_at":principal.expires_at.isoformat(),
        "is_development_identity":principal.is_development_identity,
      },
      "csrf_token":csrf_token,
      "enterprise_idp":"pending_external_configuration",
    }

@app.get("/api/v1/security/session")
def enterprise_session_status(request:Request):
    principal=request_principal(request)
    return {"status":"authenticated","principal":{
      "principal_id":principal.principal_id,
      "principal_type":principal.principal_type.value,
      "tenant_id":principal.tenant_id,
      "workspace_id":principal.workspace_id,
      "roles":sorted(principal.roles),
      "authn_method":principal.authn_method,
      "expires_at":principal.expires_at.isoformat(),
      "is_development_identity":principal.is_development_identity,
    }}

@app.get("/api/v1/security/session/csrf")
def enterprise_session_csrf(request:Request):
    validation=request.state.enterprise_session
    return {"csrf_token":ENTERPRISE_HTTP.csrf.issue(validation)}

@app.post("/api/v1/security/session/logout")
def enterprise_session_logout(request:Request,response:Response):
    validation=request.state.enterprise_session
    if PERSISTENT_CREDENTIALS is not None:
      try:
        PERSISTENT_CREDENTIALS.delete_principal(
          validation.principal.principal_id,validation.principal.tenant_id,
          validation.principal.workspace_id,
          tuple(load_platform_environments().environments.keys()))
      except CredentialVaultError as exc:
        raise HTTPException(503,detail={"code":"CREDENTIAL_DELETE_FAILED",
          "message":"Logout was stopped because encrypted credentials could not be cleared."}) from exc
    ENTERPRISE_HTTP.sessions.revoke_session(validation.session_id,"user_logout")
    clear_session_cookie(response,INGRESS_PROFILE)
    return {"status":"revoked"}

def _frontend_distribution()->Path:
    configured=os.getenv("ROUTING_CONSOLE_FRONTEND_DIST")
    return Path(configured).resolve() if configured else (ROOT/"web"/"dist").resolve()

@app.get("/runtime-config.json",include_in_schema=False)
def frontend_runtime_config():
    """Safe same-origin browser configuration; it never contains credentials."""
    return {"api_base_url":"","api_prefix":"/api","health_url":"/health",
      "ready_url":"/ready","deployment_mode":"local_operator",
      "credentials_exposed":False}

@app.get("/{frontend_path:path}",include_in_schema=False)
def frontend_application(frontend_path:str):
    """Serve the production SPA from the API process to remove proxy drift."""
    distribution=_frontend_distribution()
    index=distribution/"index.html"
    if not index.is_file():
      return HTMLResponse(
        "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
        "<meta http-equiv='refresh' content='3'><title>本地服务正在启动</title>"
        "<main><h1>本地服务正在启动</h1><p>前端构建产物尚未就绪，页面将自动重试。</p>"
        "<p>诊断编号：frontend_build_pending</p></main></html>",status_code=503,
        headers={"Cache-Control":"no-store"})
    requested=(distribution/frontend_path).resolve()
    try:
      requested.relative_to(distribution)
    except ValueError:
      raise HTTPException(404,detail={"code":"api_route_not_found"})
    if frontend_path and requested.is_file():
      return FileResponse(requested)
    return FileResponse(index,headers={"Cache-Control":"no-cache"})

# Route metadata is part of the default-deny contract and must be installed
# after every router/handler has been registered.
annotate_route_permissions(app)
app.add_middleware(
  EnterpriseHTTPAuthorizationMiddleware,runtime=ENTERPRISE_HTTP,route_app=app)
app.add_middleware(
  EnterpriseIngressMiddleware,profile=INGRESS_PROFILE,
  action_resolver=permission_for_scope,sensitive_actions=frozenset({
    "collector.session.reauthenticate","collector.oneshot.execute",
    "evidence.import","snapshot.generate","scheduler.execute","price.sync",
    "circuit.manage","exploration.manage","kill_switch.activate",
    "kill_switch.release","tenant.manage","service_identity.manage",
    "uat.execution.manage","uat.execute","uat.capability.review"}))
app.add_middleware(PrincipalPreResolutionMiddleware,runtime=ENTERPRISE_HTTP)
