from models import FieldDefinition, NodeDefinition, StepOutcome


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    return StepOutcome(
        output={
            "final_url": page.url,
            "capture_requested": True,
            "full_page": bool(node.config.get("full_page", True)),
        }
    )
