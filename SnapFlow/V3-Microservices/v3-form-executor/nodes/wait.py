from models import FieldDefinition, NodeDefinition, StepOutcome


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = node.config.get("selector")
    timeout_ms = int(node.config.get("timeout_ms") or context.settings.node_timeout_ms)
    if isinstance(selector, str) and selector.strip():
        await page.locator(selector).first.wait_for(state="visible", timeout=timeout_ms)
        return StepOutcome(output={"selector": selector, "waited_for": "visible"})
    duration_ms = min(int(node.config.get("duration_ms") or context.settings.settle_ms), timeout_ms)
    await page.wait_for_timeout(duration_ms)
    return StepOutcome(output={"duration_ms": duration_ms})
