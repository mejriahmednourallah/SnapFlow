from pathlib import Path

from models import FieldDefinition, NodeDefinition, StepOutcome
from nodes.common import element_metadata, require_selector, safe_fixture_path


def _prepare_generated_fixture(raw_path: str, fixture_root: str) -> None:
    root = Path(fixture_root)
    if raw_path == "snapflow-empty.txt":
        target = root / raw_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"")
    elif raw_path == "snapflow-6mb.bin":
        target = root / raw_path
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_size != 6 * 1024 * 1024:
            target.write_bytes(b"\0" * (6 * 1024 * 1024))


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = require_selector(node, field)
    raw_path = field.value if field else str(node.config.get("fixture") or "")
    metadata = await element_metadata(page, selector)
    if metadata["count"] == 0:
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_found",
            error_message=f"No element matched selector {selector}",
        )
    if metadata["input_type"] != "file":
        return StepOutcome(
            status="error",
            output=metadata,
            error_code="selector_not_file_input",
            error_message=f"Selector {selector} does not point to a file input.",
        )
    _prepare_generated_fixture(raw_path, context.fixture_root)
    path = safe_fixture_path(raw_path, context.fixture_root)
    await page.locator(selector).first.set_input_files(path, timeout=context.settings.node_timeout_ms)
    return StepOutcome(output={**metadata, "fixture_name": path.rsplit("/", 1)[-1]})
