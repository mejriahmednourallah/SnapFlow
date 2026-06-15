from models import FieldDefinition, NodeDefinition, StepOutcome
from nodes.common import element_metadata, require_selector


def _looks_like(value: str, kind: str) -> bool:
    if kind == "time":
        parts = value.split(":")
        return len(parts) in {2, 3} and all(part.isdigit() for part in parts) and 0 <= int(parts[0]) <= 23 and 0 <= int(parts[1]) <= 59
    if kind == "date":
        parts = value.split("-")
        return len(parts) == 3 and len(parts[0]) == 4 and all(part.isdigit() for part in parts)
    if kind == "month":
        parts = value.split("-")
        return len(parts) == 2 and len(parts[0]) == 4 and all(part.isdigit() for part in parts)
    if kind == "number":
        try:
            float(value)
            return True
        except ValueError:
            return False
    return bool(value)


def _first_valid(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_fill_value(value: str, metadata: dict) -> tuple[str, str | None]:
    input_type = str(metadata.get("input_type") or "").lower()
    original = value
    trimmed = value.strip()

    if input_type == "time" and not _looks_like(trimmed, "time"):
        return _first_valid(metadata.get("min"), "12:00") or "12:00", original
    if input_type == "date" and not _looks_like(trimmed, "date"):
        return _first_valid(metadata.get("min"), "2026-04-02") or "2026-04-02", original
    if input_type == "datetime-local" and "T" not in trimmed:
        return _first_valid(metadata.get("min"), "2026-04-02T12:00") or "2026-04-02T12:00", original
    if input_type == "month" and not _looks_like(trimmed, "month"):
        return _first_valid(metadata.get("min"), "2026-04") or "2026-04", original
    if input_type == "week" and "-W" not in trimmed:
        return _first_valid(metadata.get("min"), "2026-W14") or "2026-W14", original
    if input_type == "number" and not _looks_like(trimmed, "number"):
        return _first_valid(metadata.get("min"), "123") or "123", original
    if input_type == "email" and "@" not in trimmed:
        return "contact@example.com", original
    if input_type == "url" and not trimmed.startswith(("http://", "https://")):
        return "https://example.com", original
    if input_type == "color" and not (trimmed.startswith("#") and len(trimmed) == 7):
        return "#0e9fb0", original
    return value, None


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = require_selector(node, field)
    value = field.value if field else str(node.config.get("value") or "")
    required = field.required if field else bool(node.config.get("required"))
    if required and not value and context.snapshot.expected_outcome != "validation_error":
        return StepOutcome(
            status="failed",
            error_code="required_value_missing",
            error_message=f"Required value missing for {selector}",
        )
    metadata = await element_metadata(page, selector)
    if metadata["count"] == 0:
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_found",
            error_message=f"No element matched selector {selector}",
        )
    if metadata["input_type"] in {"checkbox", "radio", "file"} or metadata["tag"] == "select":
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_fillable",
            error_message=(
                f"Selector {selector} points to {metadata['tag']}"
                f"{'[' + metadata['input_type'] + ']' if metadata['input_type'] else ''}, not a text-fillable field."
            ),
        )
    if context.snapshot.expected_outcome == "validation_error":
        normalized_value, coerced_from = value, None
    else:
        normalized_value, coerced_from = normalize_fill_value(value, metadata)
    await page.locator(selector).first.fill(normalized_value, timeout=context.settings.node_timeout_ms)
    return StepOutcome(output={**metadata, "value_set": bool(normalized_value), "value_coerced": coerced_from is not None})
