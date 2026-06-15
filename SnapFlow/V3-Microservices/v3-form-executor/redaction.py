from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY = re.compile(
    r"(password|passwd|secret|token|authorization|cookie|session|api[_-]?key|credential)",
    re.IGNORECASE,
)
INLINE_SECRET = re.compile(
    r"((?:password|passwd|secret|token|authorization|cookie|session|api[_-]?key|credential)\s*[:=]\s*)([^\s,;]+)",
    re.IGNORECASE,
)


def redact_text(value: str | None) -> str | None:
    if value is None:
        return None
    return INLINE_SECRET.sub(r"\1[REDACTED]", value)


def redact(value: Any, sensitive_values: set[str] | None = None) -> Any:
    sensitive_values = {item for item in (sensitive_values or set()) if item}
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else redact(item, sensitive_values)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item, sensitive_values) for item in value]
    if isinstance(value, tuple):
        return [redact(item, sensitive_values) for item in value]
    if isinstance(value, str):
        result = redact_text(value) or ""
        for sensitive in sorted(sensitive_values, key=len, reverse=True):
            if sensitive:
                result = result.replace(sensitive, "[REDACTED]")
        return result
    return value
