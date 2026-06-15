from models import FieldDefinition, NodeDefinition, StepOutcome
from nodes.common import element_metadata, require_selector


def _selected(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "oui", "on", "checked"}


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = require_selector(node, field)
    value = field.value if field else str(node.config.get("value") or "")
    locator = page.locator(selector).first
    metadata = await element_metadata(page, selector)
    if metadata["count"] == 0:
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_found",
            error_message=f"No element matched selector {selector}",
        )
    input_type = ((await locator.get_attribute("type")) or "").lower()
    if input_type not in {"checkbox", "radio"}:
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_checkable",
            error_message=f"Selector {selector} points to a non-checkable element.",
        )
    if input_type == "radio" and not _selected(value):
        return StepOutcome(status="skipped", output={**metadata, "selected": False})
    if _selected(value):
        await locator.check(timeout=context.settings.node_timeout_ms)
    elif input_type == "checkbox":
        await locator.uncheck(timeout=context.settings.node_timeout_ms)
    return StepOutcome(output={**metadata, "selected": _selected(value)})
