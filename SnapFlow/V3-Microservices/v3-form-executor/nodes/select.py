from models import FieldDefinition, NodeDefinition, StepOutcome
from nodes.common import element_metadata, require_selector


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = require_selector(node, field)
    value = field.value if field else str(node.config.get("value") or "")
    metadata = await element_metadata(page, selector)
    if metadata["count"] == 0:
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_found",
            error_message=f"No element matched selector {selector}",
        )
    if metadata["tag"] != "select":
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_selectable",
            error_message=f"Selector {selector} points to a non-select element.",
        )
    selected = await page.locator(selector).first.select_option(value, timeout=context.settings.node_timeout_ms)
    return StepOutcome(output={**metadata, "selected": selected})
