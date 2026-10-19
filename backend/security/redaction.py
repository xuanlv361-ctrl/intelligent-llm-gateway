"""Shared fail-closed redaction for text and JSON-compatible values."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


_KEY_NAME = (
    r"authorization|proxy[_ -]?authorization|(?:x[_ -]?)?api[_ -]?key|apikey|"
    r"access[_ -]?token|refresh[_ -]?token|bearer[_ -]?token|auth[_ -]?token|"
    r"session[_ -]?token|id[_ -]?token|token|client[_ -]?secret|"
    r"secret[_ -]?access[_ -]?key|secret|credential|set[_ -]?cookie|cookie|"
    r"password|private[_ -]?key"
)
SENSITIVE_KEY = re.compile(rf"^(?:{_KEY_NAME})$", re.IGNORECASE)

# Quoted JSON values need a dedicated pattern.  A marker-only expression such
# as ``api_key\s*[:=]`` redacts the field name but leaves the secret untouched.
_DOUBLE_QUOTED = re.compile(
    rf'(?i)(?P<prefix>"(?:{_KEY_NAME})"\s*:\s*)"(?:\\.|[^"\\])*"'
)
_SINGLE_QUOTED = re.compile(
    rf"(?i)(?P<prefix>'(?:{_KEY_NAME})'\s*:\s*)'(?:\\.|[^'\\])*'"
)
_ASSIGNMENT = re.compile(
    rf"(?i)\b(?:{_KEY_NAME})\b\s*[:=]\s*(?:bearer\s+)?"
    r'(?:"[^"\r\n]*"|\'[^\'\r\n]*\'|[^\s,;}\]]+)'
)
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")
_KEYLIKE = re.compile(
    r"(?i)\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})\b|"
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)


def contains_sensitive_data(value: Any) -> bool:
    """Return whether a value contains a credential marker or token value."""
    if isinstance(value, Mapping):
        return any(
            SENSITIVE_KEY.fullmatch(str(key).strip())
            or contains_sensitive_data(child)
            for key, child in value.items()
        )
    if isinstance(value, (list, tuple, set)):
        return any(contains_sensitive_data(item) for item in value)
    if isinstance(value, bytes):
        text = value.decode("utf-8", "replace")
    else:
        text = str(value or "")
    return any(pattern.search(text) for pattern in (
        _DOUBLE_QUOTED, _SINGLE_QUOTED, _ASSIGNMENT, _BEARER, _KEYLIKE,
    ))


def redact_text(value: Any, *, maximum_length: int | None = None) -> str:
    """Redact both credential names and values from arbitrary text."""
    text = str(value or "")
    text = _DOUBLE_QUOTED.sub(lambda match: match.group("prefix") + '"[REDACTED]"', text)
    text = _SINGLE_QUOTED.sub(lambda match: match.group("prefix") + "'[REDACTED]'", text)
    text = _ASSIGNMENT.sub("[REDACTED]", text)
    text = _BEARER.sub("Bearer [REDACTED]", text)
    text = _KEYLIKE.sub("[REDACTED]", text)
    return text if maximum_length is None else text[:maximum_length]


def redact_value(value: Any, *, depth: int = 0) -> Any:
    """Return a JSON-compatible recursively redacted copy."""
    if depth > 12:
        return "[REDACTED_DEPTH_LIMIT]"
    if isinstance(value, Mapping):
        return {
            str(key): (
                "[REDACTED]" if SENSITIVE_KEY.fullmatch(str(key).strip())
                else redact_value(child, depth=depth + 1)
            )
            for key, child in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [redact_value(item, depth=depth + 1) for item in value]
    if isinstance(value, bytes):
        return "[REDACTED_BINARY]"
    if isinstance(value, str):
        return redact_text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_text(value)
