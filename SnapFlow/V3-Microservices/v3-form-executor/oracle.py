from __future__ import annotations

from typing import Any
import re
import unicodedata

from semantic_observation import normalize_semantic_text


SUCCESS_MESSAGE_PATTERN = re.compile(
    r"\b("
    r"merci|f[ée]licitations|bien\s+re[çc]u(?:e)?|demande\s+re[çc]u(?:e)?|"
    r"envoy[ée]e?|transmis(?:e)?|enregistr[ée]e?|confirm[ée]e?|"
    r"succ[eè]s|success|thank(?:s| you)?|submitted|received"
    r")\b",
    re.IGNORECASE,
)


def _number(value: object, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalized_identity(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    ascii_text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "_", ascii_text).strip("_")


def _target_aliases(signal: dict[str, Any], context) -> set[str]:
    case_definition = (
        context.snapshot.case_definition
        if isinstance(context.snapshot.case_definition, dict)
        else {}
    )
    aliases = {
        str(signal.get("field_id") or ""),
        str(signal.get("field_name") or ""),
        str(signal.get("field_selector") or ""),
        str(case_definition.get("target_field_id") or ""),
        str(case_definition.get("target_field_name") or ""),
    }
    normalized_targets = {_normalized_identity(item) for item in aliases if item}
    for field in context.snapshot.fields:
        field_aliases = {
            field.id,
            field.field_name,
            field.field_selector,
            _normalized_identity(field.field_name),
        }
        normalized_field_aliases = {
            _normalized_identity(item) for item in field_aliases if item
        }
        if normalized_targets & normalized_field_aliases:
            aliases.update(field_aliases)
    return {_normalized_identity(item) for item in aliases if item}


def _control_matches_target(control: dict[str, Any], aliases: set[str]) -> bool:
    control_aliases = {
        control.get("field_id"),
        control.get("field_name"),
        control.get("field_selector"),
        control.get("field_key"),
        control.get("name"),
        control.get("id"),
    }
    return bool(
        aliases
        & {_normalized_identity(item) for item in control_aliases if item}
    )


def _signals(config: dict[str, Any], context) -> list[dict[str, Any]]:
    oracle = config.get("oracle") if isinstance(config.get("oracle"), dict) else {}
    configured = oracle.get("signals") if isinstance(oracle.get("signals"), list) else None
    if configured is None:
        case_definition = (
            context.snapshot.case_definition
            if isinstance(context.snapshot.case_definition, dict)
            else {}
        )
        configured = (
            case_definition.get("expected_signals")
            if isinstance(case_definition.get("expected_signals"), list)
            else []
        )
    return [item for item in configured if isinstance(item, dict) and item.get("type")]


def _default_signals(expected_outcome: str) -> list[dict[str, Any]]:
    if expected_outcome == "validation_error":
        return [
            {"type": "form_invalid", "weight": 0.55},
            {"type": "validation_message_present", "weight": 0.45},
        ]
    if expected_outcome == "business_rejection":
        return [
            {"type": "response_status_range", "value": "200-499", "weight": 0.25},
            {"type": "dom_changed", "weight": 0.25},
            {"type": "text_present", "value": "incorrect", "weight": 0.25},
            {"type": "text_present", "value": "invalide", "weight": 0.25},
        ]
    if expected_outcome == "server_error":
        return [{"type": "response_status_range", "value": "500-599", "weight": 1.0}]
    if expected_outcome == "blocked":
        return [{"type": "text_present", "value": "captcha", "weight": 1.0}]
    return [
        {"type": "success_message_present", "weight": 0.45},
        {"type": "response_status_range", "value": "200-399", "weight": 0.2},
        {"type": "dom_changed", "weight": 0.15},
        {"type": "url_changed", "weight": 0.1},
        {"type": "form_disappeared", "weight": 0.1},
    ]


def _status_in_range(status: int, value: str) -> bool:
    try:
        lower, upper = value.split("-", 1)
        return int(lower) <= status <= int(upper)
    except (ValueError, TypeError):
        return False


async def _signal_match(page, context, signal: dict[str, Any]) -> tuple[bool, str]:
    observation = context.last_submission or {}
    signal_type = str(signal.get("type") or "")
    value = str(signal.get("value") or "")
    after_text = str(observation.get("after_text") or "")
    response_status = int(observation.get("response_status") or 0)
    target_field_id = str(signal.get("field_id") or "")
    target_aliases = (
        _target_aliases(signal, context)
        if target_field_id or signal.get("field_name") or signal.get("field_selector")
        else set()
    )
    invalid_controls = [
        item for item in observation.get("invalid_controls") or []
        if isinstance(item, dict)
    ]

    if signal_type == "form_invalid":
        semantic = observation.get("semantic_dom") or {}
        semantic_messages = [
            str(item.get("text") or "")
            for item in semantic.get("validation_messages") or []
            if isinstance(item, dict)
        ]
        if semantic_messages:
            return True, ", ".join(semantic_messages[:3])
        if target_aliases:
            matches = [
                item for item in invalid_controls
                if _control_matches_target(item, target_aliases)
            ]
            actual = (
                str(matches[0].get("validation_message") or "champ invalide")
                if matches
                else "champ cible valide"
            )
            return bool(matches), actual
        count = int(observation.get("invalid_control_count") or 0)
        return count > 0, f"{count} invalid control(s)"
    if signal_type == "validation_message_present":
        semantic = observation.get("semantic_dom") or {}
        semantic_messages = [
            str(item.get("text") or "")
            for item in semantic.get("validation_messages") or []
            if isinstance(item, dict)
        ]
        if semantic_messages:
            return True, ", ".join(semantic_messages[:3])
        if target_aliases:
            messages = [
                str(item.get("validation_message") or "")
                for item in invalid_controls
                if _control_matches_target(item, target_aliases)
                and item.get("validation_message")
            ]
            return bool(messages), ", ".join(messages[:3]) or "aucun message sur le champ cible"
        messages = observation.get("validation_messages") or []
        return bool(messages), ", ".join(str(item) for item in messages[:3]) or "none"
    if signal_type == "response_status":
        return str(response_status) == value, str(response_status or "none")
    if signal_type == "response_status_range":
        return _status_in_range(response_status, value), str(response_status or "none")
    if signal_type == "url_contains":
        return value in page.url, page.url
    if signal_type == "url_changed":
        matched = bool(observation.get("url_changed"))
        return matched, str(matched)
    if signal_type == "dom_changed":
        matched = bool(observation.get("dom_changed"))
        return matched, str(matched)
    if signal_type == "form_disappeared":
        matched = observation.get("form_present_after") is False
        return matched, "formulaire retire" if matched else "formulaire toujours visible"
    if signal_type == "network_request_matching":
        events = observation.get("network_events") or []
        matched = any(value in str(item.get("url") or "") for item in events) if value else bool(events)
        return matched, f"{len(events)} request(s)"
    if signal_type == "text_present":
        matched = bool(value and value.lower() in after_text.lower())
        return matched, "present" if matched else "absent"
    if signal_type == "success_message_present":
        semantic = observation.get("semantic_dom") or {}
        semantic_messages = [
            str(item.get("text") or "")
            for item in semantic.get("success_messages") or []
            if isinstance(item, dict)
        ]
        searchable = normalize_semantic_text("\n".join(semantic_messages))
        if value:
            matched = normalize_semantic_text(value) in searchable
            return matched, value if matched else "not_found"
        return bool(semantic_messages), semantic_messages[0] if semantic_messages else "not_found"
    if signal_type == "text_absent":
        matched = not value or value.lower() not in after_text.lower()
        return matched, "absent" if matched else "present"
    if signal_type in {"element_present", "element_absent"}:
        try:
            count = await page.locator(value).count() if value else 0
        except Exception:
            return False, "invalid_selector"
        matched = count > 0 if signal_type == "element_present" else count == 0
        return matched, str(count)
    if signal_type == "field_value_equals":
        field_id = str(signal.get("field_id") or "")
        field = next((item for item in context.snapshot.fields if item.id == field_id), None)
        if not field:
            return False, "field_not_found"
        try:
            locator = page.locator(field.field_selector).first
            if await locator.count() == 0:
                return False, "field_not_present"
            if field.field_type in {"checkbox", "radio"}:
                actual = "true" if await locator.is_checked() else "false"
            else:
                actual = await locator.input_value()
        except Exception:
            return False, "field_unreadable"
        return actual == value, actual
    return False, "unsupported_signal"


async def evaluate_submission_oracle(page, context, config: dict[str, Any]) -> dict[str, Any]:
    expected_outcome = str(
        config.get("expected_outcome")
        or context.snapshot.expected_outcome
        or "success"
    )
    oracle = config.get("oracle") if isinstance(config.get("oracle"), dict) else {}
    pass_threshold = _number(oracle.get("pass_threshold"), 0.65)
    inconclusive_threshold = _number(oracle.get("inconclusive_threshold"), 0.4)
    signals = _signals(config, context) or _default_signals(expected_outcome)

    total_weight = 0.0
    matched_weight = 0.0
    evidence: list[dict[str, Any]] = []
    for signal in signals:
        if signal.get("enabled") is False:
            continue
        weight = max(0.0, _number(signal.get("weight"), 0.25))
        matched, actual = await _signal_match(page, context, signal)
        total_weight += weight
        if matched:
            matched_weight += weight
        evidence.append(
            {
                "type": str(signal.get("type") or ""),
                "value": signal.get("value"),
                "weight": weight,
                "matched": matched,
                "actual": actual,
            }
        )

    score = matched_weight / total_weight if total_weight > 0 else 0.0
    matched_types = {
        str(item.get("type") or "")
        for item in evidence
        if item.get("matched") is True
    }
    has_partial_success_evidence = (
        expected_outcome == "success"
        and "response_status_range" in matched_types
        and "dom_changed" in matched_types
    )
    if score >= pass_threshold:
        verdict = "observed"
    elif score >= inconclusive_threshold or has_partial_success_evidence:
        verdict = "inconclusive"
    else:
        verdict = "not_observed"
    return {
        "expected_outcome": expected_outcome,
        "score": round(score, 4),
        "verdict": verdict,
        "matched": verdict == "observed",
        "pass_threshold": pass_threshold,
        "inconclusive_threshold": inconclusive_threshold,
        "evidence": evidence,
    }
