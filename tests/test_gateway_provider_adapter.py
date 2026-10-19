from copy import deepcopy
import json
from pathlib import Path

import pytest

from backend.gateway_provider_adapter import GatewayAdapterError, GatewayProviderAdapter, _NoRedirect

ROOT = Path(__file__).resolve().parents[1]


def setup_adapter(response=None):
    mapping = json.loads((ROOT / "data/model_channel_mapping_v1.json").read_text(encoding="utf-8"))
    offer = mapping["models"]["deepseek-v4.1-flash-1017"][0]
    policy = json.loads((ROOT / "config/gateway_execution_policy_v1.json").read_text(encoding="utf-8"))
    policy.update(real_execution_enabled=True, network_access_enabled=True, enabled_channels=[offer["channel_id"]])
    calls = []
    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): return None
        def read(self, limit):
            calls.append({"read_limit": limit})
            return response if response is not None else b'{"model":"deepseek-flash","choices":[{"message":{"content":"answer"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}'
    class Opener:
        def open(self, request, timeout):
            calls.append({"url":request.full_url,"body":json.loads(request.data),"timeout":timeout})
            return Response()
    adapter = GatewayProviderAdapter(policy, environ={"DEEPSEEK_API_KEY":"fixture-key-not-real"}, opener=Opener())
    payload = {"messages":[{"role":"user","content":"hello"}],"output_tokens":100,"requirements":{},"explicit_confirmation":True}
    return adapter, offer, payload, calls


def test_production_defaults_cannot_dispatch_without_configuration():
    adapter, offer, payload, calls = setup_adapter()
    adapter.policy["real_execution_enabled"] = False
    with pytest.raises(GatewayAdapterError, match="not_enabled"):
        adapter(offer,payload,"fixture-attempt")
    assert calls == []


def test_both_confirmation_and_separate_credential_are_required():
    adapter,offer,payload,calls = setup_adapter()
    with pytest.raises(GatewayAdapterError, match="confirmation"):
        adapter(offer,{**payload,"explicit_confirmation":False},"fixture")
    adapter.environ = {}
    with pytest.raises(GatewayAdapterError, match="credential"):
        adapter(offer,payload,"fixture")
    assert calls == []


def test_contract_response_keeps_billing_and_billed_model_unknown():
    adapter,offer,payload,calls = setup_adapter()
    result = adapter(offer,payload,"fixture-attempt")
    assert result["success"] is True
    assert result["actual_model"] == "deepseek-flash"
    assert result["billed_model"] is None and result["actual_cost"] is None
    assert result["billing_state"] == "unknown"
    assert calls[0]["url"] == "https://api.deepseek.com/chat/completions"
    assert calls[0]["body"]["thinking"]["type"] == "enabled"
    assert calls[1]["read_limit"] == 1000001
    assert "fixture-key-not-real" not in json.dumps(result)


@pytest.mark.parametrize("code",[301,302,303,307,308])
def test_redirects_never_forward_credentials(code):
    assert _NoRedirect().redirect_request(None,None,code,"redirect",{},"https://evil.invalid") is None


def test_oversized_response_retains_uncertain_charge():
    adapter,offer,payload,calls = setup_adapter(b"x"*1000001)
    result = adapter(offer,payload,"fixture")
    assert result["error_category"] == "response_too_large"
    assert result["billing_state"] == "unknown"


def test_request_url_cannot_be_changed_to_an_unapproved_host():
    adapter,offer,payload,calls = setup_adapter()
    with pytest.raises(GatewayAdapterError, match="host"):
        adapter({**offer,"api_base":"https://attacker.invalid"},payload,"fixture")
    assert not calls


@pytest.mark.parametrize("payload_change",[
    {"requirements":{"stream":True}}, {"requirements":{"tool_calling":True}},
    {"output_tokens":0}, {"output_tokens":True},
    {"messages":[{"role":"user","content":"api_key=fixture-secret-value"}]},
])
def test_unready_or_invalid_requests_never_reach_transport(payload_change):
    adapter,offer,payload,calls = setup_adapter()
    with pytest.raises(GatewayAdapterError):
        adapter(offer,{**payload,**payload_change},"fixture")
    assert calls == []


@pytest.mark.parametrize("base", ["https://attacker.invalid", "https://api.deepseek.com:bad",
    "https://name:secret@api.deepseek.com", "http://api.deepseek.com", "https://api.deepseek.com?x=1",
    "https://api.deepseek.com\n", "https://api.deepseek.com:444"])
def test_destination_preflight_blocks_before_claim_or_transport(base):
    adapter, offer, payload, calls = setup_adapter()
    changed = {**offer, "api_base": base}
    readiness = adapter.readiness(changed)
    assert readiness["ready"] is False
    assert readiness["blocked_reason"] == "provider_host_not_allowed"
    with pytest.raises(GatewayAdapterError, match="host"):
        adapter.validate(changed, payload)
    assert calls == []


@pytest.mark.parametrize("workspace", [None, "", "invalid workspace", "../escape"])
def test_qwen_requires_workspace_in_readiness_and_validation(workspace):
    adapter, _, payload, calls = setup_adapter()
    mapping = json.loads((ROOT / "data/model_channel_mapping_v1.json").read_text(encoding="utf-8"))
    offer = mapping["models"]["qwen3.7-plus-2026-05-26"][0]
    adapter.policy["enabled_channels"] = [offer["channel_id"]]
    adapter.environ = {"DASHSCOPE_API_KEY": "fixture-only"}
    if workspace is not None:
        adapter.environ["DASHSCOPE_WORKSPACE_ID"] = workspace
    assert adapter.readiness(offer)["ready"] is False
    assert adapter.readiness(offer)["blocked_reason"] == "provider_workspace_not_configured"
    with pytest.raises(GatewayAdapterError, match="workspace"):
        adapter.validate(offer, payload)
    assert not calls


def test_qwen_valid_workspace_is_checked_without_network():
    adapter, _, payload, calls = setup_adapter()
    mapping = json.loads((ROOT / "data/model_channel_mapping_v1.json").read_text(encoding="utf-8"))
    offer = mapping["models"]["qwen3.7-plus-2026-05-26"][0]
    adapter.policy["enabled_channels"] = [offer["channel_id"]]
    adapter.environ = {"DASHSCOPE_API_KEY": "fixture-only", "DASHSCOPE_WORKSPACE_ID": "workspace-123"}
    assert adapter.readiness(offer)["ready"] is True
    adapter.validate(offer, payload)
    assert calls == []


@pytest.mark.parametrize("body", [
    [], {"usage": [], "choices": [{"message": {"content": "ok"}}]},
    {"choices": "not-list"}, {"choices": ["not-object"]}, {"choices": [{"message": []}]},
    {"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens_details": []}},
    {"choices": {"message": {"content": "ok"}}},
])
def test_malformed_provider_response_is_sanitized_unknown_billing(body):
    adapter, offer, payload, calls = setup_adapter(json.dumps(body).encode())
    result = adapter(offer, payload, "fixture")
    assert result["error_category"] == "invalid_provider_response"
    assert result["billing_state"] == "unknown"
    assert result["network_called"] is True


def anthropic_adapter(body):
    adapter, _, payload, calls = setup_adapter(json.dumps(body).encode())
    mapping = json.loads((ROOT / "data/model_channel_mapping_v1.json").read_text(encoding="utf-8"))
    offer = mapping["models"]["claude-sonnet-5-5"][0]
    adapter.policy["enabled_channels"] = [offer["channel_id"]]
    adapter.environ = {"ANTHROPIC_API_KEY": "fixture-only"}
    return adapter, offer, payload, calls


def test_anthropic_total_input_includes_all_cache_buckets():
    adapter, offer, payload, calls = anthropic_adapter({"model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": "answer"}],
        "usage": {"input_tokens": 10, "cache_creation_input_tokens": 20,
                  "cache_read_input_tokens": 30, "output_tokens": 5}})
    result = adapter(offer, payload, "fixture")
    assert result["success"] is True
    assert result["input_tokens"] == 60
    assert result["uncached_input_tokens"] == 10
    assert result["cached_input_tokens"] == 30
    assert result["cache_creation_input_tokens"] == 20


def test_anthropic_missing_cache_counts_remain_unknown():
    adapter, offer, payload, calls = anthropic_adapter({"content": [{"text": "answer"}],
        "usage": {"input_tokens": 10, "output_tokens": 5}})
    result = adapter(offer, payload, "fixture")
    assert result["input_tokens"] is None
    assert result["uncached_input_tokens"] == 10
    assert result["cached_input_tokens"] is None
    assert result["cache_creation_input_tokens"] is None


@pytest.mark.parametrize("body", [{"content": "text"}, {"content": ["text"]},
                                 {"content": [{"text": {"private": "value"}}]}])
def test_malformed_anthropic_content_never_raises_or_stringifies_objects(body):
    adapter, offer, payload, _ = anthropic_adapter(body)
    result = adapter(offer, payload, "fixture")
    assert result["error_category"] == "invalid_provider_response"
    assert "private" not in json.dumps(result)


@pytest.mark.parametrize("field", ["model", "messages", "stream", "max_tokens"])
def test_catalog_parameters_cannot_override_request_safety_bounds(field):
    adapter, offer, payload, calls = setup_adapter()
    with pytest.raises(GatewayAdapterError, match="unsafe_provider_request_parameters"):
        adapter.validate({**offer, "request_parameters": {field: "override"}}, payload)
    assert calls == []


@pytest.mark.parametrize("name,value", [("OFFLINE_MODE", "true"), ("ALLOW_REAL_API_CALLS", "false")])
def test_explicit_environment_safety_flag_vetoes_enabled_policy(name, value):
    adapter, offer, payload, calls = setup_adapter()
    adapter.environ[name] = value
    readiness = adapter.readiness(offer)
    assert readiness["environment_veto"] is True
    assert readiness["enabled"] is False
    assert readiness["ready"] is False
    assert readiness["blocked_reason"] == "environment_execution_disabled"
    with pytest.raises(GatewayAdapterError, match="not_enabled"):
        adapter(offer, payload, "fixture")
    assert calls == []
