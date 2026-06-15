from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from models import FieldDefinition, NodeDefinition, StepOutcome


BROWSER_MANAGED_FIELD_NAMES = {
    "form_build_id",
    "form_token",
    "form_id",
    "captcha_sid",
    "captcha_token",
    "captcha_cacheable",
    "g-recaptcha-response",
    "h-captcha-response",
    "cf-turnstile-response",
}
CHOICE_FIELD_TYPES = {"checkbox", "radio"}
VALUE_SELECTOR_RE = re.compile(r"\[value\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\]]+)\]", re.IGNORECASE)


@dataclass(frozen=True)
class SelectorResolution:
    original_selector: str
    resolved_selector: str | None
    metadata: dict[str, Any]
    recovered: bool = False
    skip_reason: str | None = None

    @property
    def should_skip(self) -> bool:
        return self.skip_reason is not None

    def diagnostics(self) -> dict[str, Any]:
        return {
            "original_selector": self.original_selector,
            "resolved_selector": self.resolved_selector,
            "selector_recovered": self.recovered,
            **({"skip_reason": self.skip_reason} if self.skip_reason else {}),
        }


def normalized_field_name(value: str) -> str:
    return value.strip().lower().removesuffix("[]")


def browser_managed_field_reason(field_name: str) -> str | None:
    normalized = normalized_field_name(field_name)
    if normalized in BROWSER_MANAGED_FIELD_NAMES:
        return "browser_managed_field"
    if re.search(r"(^|[_-])(csrf|xsrf)([_-]|$)", normalized):
        return "csrf_token"
    return None


def _selector_without_value(selector: str) -> str:
    return VALUE_SELECTOR_RE.sub("", selector).strip()


def _selector_for_name(field_name: str) -> str:
    return f'[name={json.dumps(field_name)}]'


def _metadata_compatible(metadata: dict[str, Any], field_type: str) -> bool:
    tag = str(metadata.get("tag") or "").lower()
    input_type = str(metadata.get("input_type") or "").lower()
    expected = field_type.lower()
    if expected == "select":
        return tag == "select"
    if expected == "textarea":
        return tag == "textarea"
    if expected in CHOICE_FIELD_TYPES | {"file"}:
        return input_type == expected
    return tag in {"input", "textarea"} and input_type not in {"hidden", "checkbox", "radio", "file"}


async def resolve_field_selector(
    page,
    node: NodeDefinition,
    field: FieldDefinition,
    *,
    captcha_solved: bool = False,
) -> SelectorResolution:
    original = node_selector(node, field)
    managed_reason = browser_managed_field_reason(field.field_name)
    if managed_reason:
        return SelectorResolution(
            original_selector=original,
            resolved_selector=None,
            metadata={"selector": original, "count": 0},
            skip_reason=managed_reason,
        )

    candidates = [original]
    if field.field_type not in CHOICE_FIELD_TYPES:
        without_value = _selector_without_value(original)
        if without_value and without_value != original:
            candidates.append(without_value)
    if field.field_name:
        candidates.append(_selector_for_name(field.field_name))

    seen: set[str] = set()
    last_metadata: dict[str, Any] = {"selector": original, "count": 0}
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        metadata = await element_metadata(page, candidate)
        last_metadata = metadata
        if metadata["count"] == 0:
            continue
        if metadata.get("input_type") == "hidden":
            return SelectorResolution(
                original_selector=original,
                resolved_selector=None,
                metadata=metadata,
                recovered=candidate != original,
                skip_reason="hidden_field",
            )
        if candidate == _selector_for_name(field.field_name) and metadata["count"] != 1:
            continue
        if not _metadata_compatible(metadata, field.field_type):
            continue
        return SelectorResolution(
            original_selector=original,
            resolved_selector=candidate,
            metadata=metadata,
            recovered=candidate != original,
        )

    if normalized_field_name(field.field_name) == "captcha_response" and captcha_solved:
        return SelectorResolution(
            original_selector=original,
            resolved_selector=None,
            metadata=last_metadata,
            skip_reason="captcha_field_replaced_after_resolution",
        )
    return SelectorResolution(
        original_selector=original,
        resolved_selector=original or None,
        metadata=last_metadata,
    )


def node_selector(node: NodeDefinition, field: FieldDefinition | None = None) -> str:
    if field and field.field_selector:
        return field.field_selector
    selector = node.config.get("selector")
    return selector.strip() if isinstance(selector, str) else ""


def require_selector(node: NodeDefinition, field: FieldDefinition | None = None) -> str:
    selector = node_selector(node, field)
    if not selector:
        raise ValueError("selector_missing")
    return selector


async def element_metadata(page, selector: str) -> dict[str, Any]:
    locator = page.locator(selector).first
    count = await page.locator(selector).count()
    if count == 0:
        return {
            "selector": selector,
            "count": 0,
            "tag": None,
            "input_type": None,
            "visible": False,
            "enabled": False,
        }
    tag = (await locator.evaluate("element => element.tagName.toLowerCase()")) or ""
    input_type = ((await locator.get_attribute("type")) or "").lower()
    return {
        "selector": selector,
        "count": count,
        "tag": tag,
        "input_type": input_type,
        "min": await locator.get_attribute("min"),
        "max": await locator.get_attribute("max"),
        "step": await locator.get_attribute("step"),
        "visible": await locator.is_visible(),
        "enabled": await locator.is_enabled(),
    }


def handler_type_from_element(metadata: dict[str, Any]) -> str | None:
    tag = str(metadata.get("tag") or "").lower()
    input_type = str(metadata.get("input_type") or "").lower()
    if tag == "select":
        return "select"
    if input_type in {"checkbox", "radio"}:
        return "check"
    if input_type == "file":
        return "upload"
    if tag == "textarea":
        return "fill"
    if tag == "input" or tag in {"button"}:
        return "fill"
    return None


def safe_fixture_path(raw_path: str, fixture_root: str) -> str:
    root = Path(fixture_root).resolve()
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve()
    if root != candidate and root not in candidate.parents:
        raise ValueError("upload_fixture_outside_allowed_directory")
    if not candidate.is_file():
        raise ValueError("upload_fixture_not_found")
    return str(candidate)


async def locator_summary(locator) -> dict[str, Any]:
    return {
        "count": await locator.count(),
        "visible": await locator.first.is_visible() if await locator.count() else False,
    }


def passed(**output: Any) -> StepOutcome:
    return StepOutcome(status="passed", output=output)
