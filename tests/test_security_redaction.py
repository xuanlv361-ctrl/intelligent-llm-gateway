from __future__ import annotations

import json

from backend.security.redaction import (
    contains_sensitive_data, redact_text, redact_value,
)


def test_quoted_json_secret_values_are_removed_not_only_the_key_marker():
    source = '{"api_key":"SUPERSECRET123","nested":{"token":"SECONDSECRET456"}}'
    cleaned = redact_text(source)
    assert contains_sensitive_data(source) is True
    assert "SUPERSECRET123" not in cleaned
    assert "SECONDSECRET456" not in cleaned
    assert cleaned.count("[REDACTED]") == 2


def test_header_assignment_and_bearer_values_are_removed():
    source = "Authorization: Bearer SUPERSECRET123\npassword=hunter2"
    cleaned = redact_text(source)
    assert "SUPERSECRET123" not in cleaned
    assert "hunter2" not in cleaned
    assert not contains_sensitive_data(cleaned)


def test_structured_redaction_keeps_observability_token_counts():
    source = {
        "api_key": "SUPERSECRET123",
        "input_tokens": 12,
        "output_tokens": 4,
        "detail": "token=SECONDSECRET456",
    }
    cleaned = redact_value(source)
    assert cleaned["api_key"] == "[REDACTED]"
    assert cleaned["input_tokens"] == 12
    assert cleaned["output_tokens"] == 4
    assert "SECONDSECRET456" not in json.dumps(cleaned)


def test_header_aliases_and_session_tokens_are_redacted():
    source = {
        "X-API-Key": "SUPERSECRET123",
        "Set-Cookie": "session=SECONDSECRET456",
        "session_token": "THIRDSECRET789",
        "message": "Proxy-Authorization: Bearer FOURTHSECRET000",
    }
    cleaned = redact_value(source)
    serialized = json.dumps(cleaned)
    assert "SUPERSECRET123" not in serialized
    assert "SECONDSECRET456" not in serialized
    assert "THIRDSECRET789" not in serialized
    assert "FOURTHSECRET000" not in serialized
