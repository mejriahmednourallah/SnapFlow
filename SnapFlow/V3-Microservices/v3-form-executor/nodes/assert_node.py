from models import FieldDefinition, NodeDefinition, StepOutcome
from oracle import evaluate_submission_oracle


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    assertion_type = str(node.config.get("type") or "text_present")
    value = str(node.config.get("value") or "").strip()
    label = str(node.config.get("label") or "Assertion")
    if assertion_type == "submission_outcome":
        result = await evaluate_submission_oracle(page, context, node.config)
        passed = result["verdict"] == "observed"
        inconclusive = result["verdict"] == "inconclusive"
        assertion = {
            "label": label,
            "expected": str(result["expected_outcome"]),
            "actual": f"{result['verdict']} ({round(result['score'] * 100)}%)",
            "passed": passed,
        }
        return StepOutcome(
            status="passed" if passed else "inconclusive" if inconclusive else "failed",
            output={"assertion_type": assertion_type, "oracle": result},
            assertions=[assertion],
            error_code=None if passed else "submission_outcome_inconclusive" if inconclusive else "submission_outcome_not_observed",
            error_message=None if passed else "Submission outcome evidence was inconclusive." if inconclusive else "Expected submission outcome was not observed.",
        )

    if not value and assertion_type not in {"form_invalid", "validation_message_present", "form_disappeared", "dom_changed", "url_changed"}:
        return StepOutcome(
            status="failed",
            error_code="assertion_value_missing",
            error_message=f"Assertion value missing: {label}",
        )

    if assertion_type == "url_contains":
        actual = page.url
        passed = value in actual
    elif assertion_type == "element_present":
        actual = str(await page.locator(value).count())
        passed = int(actual) > 0
    elif assertion_type == "element_absent":
        actual = str(await page.locator(value).count())
        passed = int(actual) == 0
    elif assertion_type == "response_status":
        actual = str((context.last_response or {}).get("status"))
        passed = actual == value
    elif assertion_type == "form_invalid":
        invalid_count = await page.locator("input:invalid, select:invalid, textarea:invalid").count()
        actual = str(invalid_count)
        passed = invalid_count > 0
    elif assertion_type == "text_absent":
        body_text = await page.locator("body").inner_text()
        actual = "absent" if value.lower() not in body_text.lower() else "present"
        passed = actual == "absent"
    else:
        body_text = await page.locator("body").inner_text()
        actual = "present" if value.lower() in body_text.lower() else "absent"
        passed = actual == "present"

    assertion = {
        "label": label,
        "expected": f"{assertion_type}: {value}",
        "actual": actual,
        "passed": passed,
    }
    return StepOutcome(
        status="passed" if passed else "failed",
        output={"assertion_type": assertion_type},
        assertions=[assertion],
        error_code=None if passed else "assertion_failed",
        error_message=None if passed else f"Assertion failed: {label}",
    )
