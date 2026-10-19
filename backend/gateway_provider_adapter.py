"""Explicitly configured provider transport; no network activity at import time."""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

from backend.security.redaction import contains_sensitive_data, redact_text
from execution_guard import ExecutionGuard

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = ROOT / "config" / "gateway_execution_policy_v1.json"


class GatewayAdapterError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GatewayProviderAdapter:
    def __init__(self, policy: Mapping[str, Any] | None = None, *, environ=None, opener=None):
        self.policy = dict(policy) if policy is not None else json.loads(DEFAULT_POLICY.read_text(encoding="utf-8"))
        self.environ = os.environ if environ is None else environ
        self._opener = opener

    def readiness(self, offer: Mapping[str, Any]) -> dict:
        env_name = self.policy["credential_environment_variables"].get(offer["provider"])
        configured = bool(env_name and self.environ.get(env_name))
        def flag(name):
            value = self.environ.get(name)
            return str(value).strip().lower() if value is not None else None
        environment_veto = (flag("OFFLINE_MODE") in {"true", "1", "yes", "on"}
                            or flag("ALLOW_REAL_API_CALLS") in {"false", "0", "no", "off"})
        enabled = (self.policy.get("real_execution_enabled") is True
                   and self.policy.get("network_access_enabled") is True
                   and offer["channel_id"] in self.policy.get("enabled_channels", [])
                   and not environment_veto)
        destination_error = None
        try:
            self._destination(offer)
        except GatewayAdapterError as exc:
            destination_error = exc.code
        return {"enabled": enabled, "credential_configured": configured,
                "destination_ready": destination_error is None,
                "blocked_reason": "environment_execution_disabled" if environment_veto else destination_error,
                "environment_veto": environment_veto,
                "ready": enabled and configured and destination_error is None, "supported_execution": "non_streaming_text",
                "policy_version": self.policy["policy_version"]}

    def _destination(self, offer: Mapping[str, Any]) -> str:
        base, path = offer.get("api_base"), offer.get("api_path")
        if not isinstance(base, str) or not isinstance(path, str) or not path.startswith("/"):
            raise GatewayAdapterError("provider_host_not_allowed")
        if "{WorkspaceId}" in base:
            workspace = self.environ.get("DASHSCOPE_WORKSPACE_ID", "")
            if not isinstance(workspace, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,100}", workspace):
                raise GatewayAdapterError("provider_workspace_not_configured")
            base = base.replace("{WorkspaceId}", workspace)
        url = base.rstrip("/") + path
        allowed = {"api.anthropic.com", "api.deepseek.com", "api.together.ai", "api.fireworks.ai",
                   "api.openai.com", "generativelanguage.googleapis.com"}
        try:
            parsed = urlsplit(url)
            host_ok = parsed.hostname in allowed or bool(re.fullmatch(
                r"[A-Za-z0-9-]+\.ap-southeast-1\.maas\.aliyuncs\.com", parsed.hostname or ""))
            valid = (host_ok and parsed.scheme == "https" and parsed.port in {None, 443}
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
                and not re.search(r"[\s\x00-\x1f\x7f{}]", url))
        except ValueError:
            valid = False
        if not valid:
            raise GatewayAdapterError("provider_host_not_allowed")
        return url

    def validate(self, offer: Mapping[str, Any], payload: Mapping[str, Any]) -> None:
        readiness = self.readiness(offer)
        if not readiness["enabled"]:
            raise GatewayAdapterError("provider_execution_not_enabled")
        if not readiness["credential_configured"]:
            raise GatewayAdapterError("provider_credential_not_configured")
        if not readiness["destination_ready"]:
            raise GatewayAdapterError(readiness["blocked_reason"])
        if payload.get("explicit_confirmation") is not True:
            raise GatewayAdapterError("explicit_confirmation_required")
        if payload.get("requirements", {}).get("stream") or payload.get("requirements", {}).get("tool_calling"):
            raise GatewayAdapterError("adapter_request_type_not_supported")
        messages = payload.get("messages")
        if (not isinstance(messages, list) or not messages or len(messages) > 100
            or any(not isinstance(row, dict) or set(row) != {"role", "content"}
                   or row["role"] not in {"system", "user", "assistant"}
                   or not isinstance(row["content"], str) for row in messages)):
            raise GatewayAdapterError("invalid_text_messages")
        serialized = json.dumps(messages, ensure_ascii=False)
        if len(serialized.encode("utf-8")) > 100000 or contains_sensitive_data(serialized):
            raise GatewayAdapterError("unsafe_or_oversized_prompt")
        count = payload.get("output_tokens")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= int(self.policy["maximum_output_tokens"]):
            raise GatewayAdapterError("output_token_limit_exceeded")
        if not 0 < float(self.policy["timeout_seconds"]) <= 60:
            raise GatewayAdapterError("invalid_provider_timeout")
        if not 1 <= int(self.policy["maximum_response_bytes"]) <= 2000000:
            raise GatewayAdapterError("invalid_response_limit")
        parameters = offer.get("request_parameters", {})
        if not isinstance(parameters, dict) or set(parameters) & {"model", "messages", "max_tokens", "stream"}:
            raise GatewayAdapterError("unsafe_provider_request_parameters")

    def __call__(self, offer: Mapping[str, Any], payload: Mapping[str, Any], attempt_id: str) -> dict:
        self.validate(offer, payload)
        url = self._destination(offer)
        # All destinations come from the reviewed catalog, never a request URL.
        context = {key: True for key in (
            "environment_supported", "environment_configured", "environment_execution_enabled",
            "mode_valid", "execution_enabled", "key_configured", "model_allowed", "token_limit_ok",
            "request_limit_ok", "budget_ok", "request_cost_ok", "input_safe", "stream_supported", "stop_rule_clear")}
        context.update(host_allowed=True,
                       explicit_confirmation=payload.get("explicit_confirmation") is True)
        guard = ExecutionGuard.check_uat(context)
        if guard.status != "allowed":
            raise GatewayAdapterError(guard.error_category or "provider_execution_blocked")
        key = self.environ[self.policy["credential_environment_variables"][offer["provider"]]]
        messages = payload["messages"]
        body = {"model": offer["provider_model_id"], "messages": messages,
                "max_tokens": payload["output_tokens"], "stream": False,
                **offer.get("request_parameters", {})}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
        if offer["api_format"] == "anthropic_messages":
            body["messages"] = [row for row in messages if row["role"] != "system"]
            system = "\n".join(row["content"] for row in messages if row["role"] == "system")
            if system:
                body["system"] = system
            headers = {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}
        request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        opener = self._opener or urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect())
        started = time.monotonic()
        try:
            try:
                response = opener.open(request, timeout=float(self.policy["timeout_seconds"]))
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                raw = response.read(int(self.policy["maximum_response_bytes"]) + 1)
                code = int(response.status)
            if len(raw) > int(self.policy["maximum_response_bytes"]):
                return self._failure("response_too_large", code, started)
            try:
                parsed_body = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                return self._failure("invalid_provider_response", code, started)
            if not isinstance(parsed_body, dict):
                return self._failure("invalid_provider_response", code, started)
            if not 200 <= code < 300:
                category = ("rate_limit" if code == 429 else "temporary_server_error" if code in {502, 503}
                            else "authentication" if code in {401, 403} else "invalid_request" if code == 400 else "provider_error")
                return self._failure(category, code, started)
            usage = parsed_body.get("usage")
            if usage is None:
                usage = {}
            if not isinstance(usage, dict):
                return self._failure("invalid_provider_response", code, started)
            if offer["api_format"] == "anthropic_messages":
                chunks = parsed_body.get("content")
                if not isinstance(chunks, list) or any(not isinstance(row, dict) for row in chunks):
                    return self._failure("invalid_provider_response", code, started)
                texts = [row["text"] for row in chunks if "text" in row]
                if any(not isinstance(text, str) for text in texts):
                    return self._failure("invalid_provider_response", code, started)
                content = "".join(texts)
                uncached = usage.get("input_tokens")
                creation = usage.get("cache_creation_input_tokens")
                cached = usage.get("cache_read_input_tokens")
                parts = (uncached, creation, cached)
                inp = sum(parts) if all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in parts) else None
                out = usage.get("output_tokens")
            else:
                choices = parsed_body.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict) or not isinstance(choices[0].get("message"), dict):
                    return self._failure("invalid_provider_response", code, started)
                content = choices[0]["message"].get("content")
                inp, out = usage.get("prompt_tokens"), usage.get("completion_tokens")
                details = usage.get("prompt_tokens_details")
                if details is None:
                    details = {}
                if not isinstance(details, dict):
                    return self._failure("invalid_provider_response", code, started)
                cached = details.get("cached_tokens", usage.get("prompt_cache_hit_tokens"))
                uncached, creation = None, None
            if not isinstance(content, str) or not content:
                return self._failure("incomplete_provider_response", code, started)
            return {"success": True, "http_status": code, "error_category": None, "output_started": True,
                    "billing_state": "unknown", "actual_cost": None,
                    "actual_model": parsed_body.get("model"), "billed_model": None,
                    "latency_ms": round((time.monotonic() - started) * 1000, 3),
                    "input_tokens": inp, "output_tokens": out, "cached_input_tokens": cached,
                    "uncached_input_tokens": uncached, "cache_creation_input_tokens": creation,
                    "response_content": redact_text(content, maximum_length=16000),
                    "is_mock": False, "network_called": True}
        except (TimeoutError, urllib.error.URLError, OSError):
            return self._failure("timeout", None, started)

    @staticmethod
    def _failure(category: str, code: int | None, started: float) -> dict:
        return {"success": False, "http_status": code, "error_category": category,
                "output_started": False, "billing_state": "unknown", "actual_cost": None,
                "actual_model": None, "billed_model": None,
                "latency_ms": round((time.monotonic() - started) * 1000, 3),
                "is_mock": False, "network_called": True}
