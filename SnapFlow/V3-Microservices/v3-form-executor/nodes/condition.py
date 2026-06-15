from models import FieldDefinition, NodeDefinition, StepOutcome
from oracle import evaluate_submission_oracle


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    condition_type = str(node.config.get("type") or "element_present")
    value = str(node.config.get("value") or "")
    if condition_type == "submission_outcome":
        result = await evaluate_submission_oracle(page, context, node.config)
        return StepOutcome(
            output={
                "condition": condition_type,
                "matched": result["matched"],
                "oracle": result,
            }
        )
    if condition_type == "field_value_equals":
        result = await evaluate_submission_oracle(
            page,
            context,
            {
                "expected_outcome": context.snapshot.expected_outcome,
                "oracle": {
                    "pass_threshold": 1,
                    "inconclusive_threshold": 0.5,
                    "signals": [{
                        "type": "field_value_equals",
                        "field_id": node.config.get("field_id"),
                        "value": value,
                        "weight": 1,
                    }],
                },
            },
        )
        matched = bool(result["matched"])
    elif condition_type == "url_contains":
        matched = value in page.url
    elif condition_type == "text_present":
        matched = value.lower() in (await page.locator("body").inner_text()).lower()
    elif condition_type == "text_absent":
        matched = value.lower() not in (await page.locator("body").inner_text()).lower()
    elif condition_type == "element_absent":
        matched = not value or await page.locator(value).count() == 0
    elif condition_type == "response_status":
        matched = str((context.last_response or {}).get("status") or "") == value
    elif condition_type == "response_status_range":
        result = await evaluate_submission_oracle(
            page,
            context,
            {
                "oracle": {
                    "pass_threshold": 1,
                    "inconclusive_threshold": 0.5,
                    "signals": [{"type": "response_status_range", "value": value, "weight": 1}],
                },
            },
        )
        matched = bool(result["matched"])
    elif condition_type in {
        "validation_message_present",
        "form_disappeared",
        "dom_changed",
        "url_changed",
        "network_request_matching",
    }:
        result = await evaluate_submission_oracle(
            page,
            context,
            {
                "oracle": {
                    "pass_threshold": 1,
                    "inconclusive_threshold": 0.5,
                    "signals": [{"type": condition_type, "value": value, "weight": 1}],
                },
            },
        )
        matched = bool(result["matched"])
    elif condition_type == "form_invalid":
        matched = await page.locator("input:invalid, select:invalid, textarea:invalid").count() > 0
    else:
        matched = bool(value and await page.locator(value).count())
    return StepOutcome(output={"condition": condition_type, "value": value, "matched": matched})
