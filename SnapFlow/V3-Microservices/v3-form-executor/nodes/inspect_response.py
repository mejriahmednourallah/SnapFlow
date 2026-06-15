from models import FieldDefinition, NodeDefinition, StepOutcome


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    if context.last_submission:
        observation = {
            key: value
            for key, value in context.last_submission.items()
            if key != "after_text"
        }
        return StepOutcome(output={"submission": observation, "final_url": page.url})
    if not context.last_response:
        return StepOutcome(
            status="failed",
            error_code="response_not_observed",
            error_message="No network response was observed",
        )
    return StepOutcome(output={"response": context.last_response, "final_url": page.url})
