from models import FieldDefinition, NodeDefinition, StepOutcome
from nodes.common import require_selector


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = require_selector(node, field)
    await page.locator(selector).first.click(timeout=context.settings.node_timeout_ms)
    await page.wait_for_timeout(context.settings.settle_ms)
    return StepOutcome(output={"selector": selector, "final_url": page.url})
