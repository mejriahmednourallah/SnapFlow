import re
import unicodedata
from urllib.parse import urljoin, urlparse

from models import FieldDefinition, NodeDefinition, StepOutcome
from semantic_observation import classify_message_evidence, normalize_semantic_text


DEFAULT_SELECTOR = "button[type='submit'], input[type='submit'], button:not([type])"
MAX_ADDED_SNIPPETS = 5
MAX_SNIPPET_LENGTH = 240
TRACKING_HOST_MARKERS = (
    "google-analytics.com",
    "googletagmanager.com",
    "clarity.ms",
    "facebook.com/tr",
    "doubleclick.net",
)
TRACKING_PATH_MARKERS = ("/collect", "/analytics", "/pixel", "/events")


def _repair_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value or "")
    if not any(marker in normalized for marker in ("Ã", "Â", "â€", "ðŸ")):
        return normalized
    candidates = [normalized]
    for encoding in ("latin-1", "cp1252"):
        try:
            candidates.append(normalized.encode(encoding).decode("utf-8"))
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return min(
        candidates,
        key=lambda item: sum(item.count(marker) for marker in ("Ã", "Â", "â€", "ðŸ")),
    )


def _normalized_fragments(value: str) -> list[str]:
    fragments = re.split(r"[\r\n]+|(?<=[.!?])\s+", _repair_text(value))
    return [
        re.sub(r"\s+", " ", fragment).strip()
        for fragment in fragments
        if len(re.sub(r"\s+", " ", fragment).strip()) >= 4
    ]


def _added_text_snippets(before_text: str, after_text: str) -> list[str]:
    before = {fragment.casefold() for fragment in _normalized_fragments(before_text)}
    snippets: list[str] = []
    seen: set[str] = set()
    for fragment in _normalized_fragments(after_text):
        key = fragment.casefold()
        if key in before or key in seen:
            continue
        seen.add(key)
        snippets.append(fragment[:MAX_SNIPPET_LENGTH])
        if len(snippets) >= MAX_ADDED_SNIPPETS:
            break
    return snippets


def _stable_field_key(name: str, selector: str, field_type: str) -> str:
    normalized_name = re.sub(r"[^a-z0-9]+", "_", name.casefold()).strip("_")
    return f"{normalized_name}:{field_type.casefold()}:{selector.casefold()}"


def _field_for_invalid_control(
    control: dict, fields: list[FieldDefinition]
) -> FieldDefinition | None:
    control_id = str(control.get("id") or "")
    control_name = str(control.get("name") or "")
    for field in fields:
        selector = field.field_selector
        if control_id and (
            selector == f"#{control_id}"
            or f'[id="{control_id}"]' in selector
            or f"[id='{control_id}']" in selector
        ):
            return field
        if control_name and (
            f'[name="{control_name}"]' in selector
            or f"[name='{control_name}']" in selector
            or field.field_name == control_name
        ):
            return field
    return None


def _is_tracking_event(event: dict) -> bool:
    parsed = urlparse(str(event.get("url") or ""))
    host = parsed.netloc.casefold()
    path = parsed.path.casefold()
    return any(marker in host for marker in TRACKING_HOST_MARKERS) or any(
        marker in path for marker in TRACKING_PATH_MARKERS
    )


def _submission_response(
    events: list[dict],
    *,
    action_url: str,
    method: str,
    page_url: str,
) -> dict | None:
    action = urljoin(page_url, action_url or page_url)
    action_parsed = urlparse(action)
    expected_method = (method or "GET").upper()
    ranked: list[tuple[float, int, dict]] = []
    for index, event in enumerate(events):
        if _is_tracking_event(event):
            continue
        resource_type = str(event.get("resource_type") or "")
        if resource_type not in {"document", "xhr", "fetch"}:
            continue
        event_url = str(event.get("url") or "")
        event_parsed = urlparse(event_url)
        event_method = str(event.get("method") or "GET").upper()
        score = 0.0
        if event_method == expected_method:
            score += 5
        if event_parsed.netloc == action_parsed.netloc:
            score += 3
        if event_url.rstrip("/") == action.rstrip("/"):
            score += 8
        elif event_parsed.path.rstrip("/") == action_parsed.path.rstrip("/"):
            score += 6
        elif action_parsed.path and event_parsed.path.startswith(action_parsed.path.rstrip("/")):
            score += 3
        if resource_type == "document":
            score += 2
        ranked.append((score, index, event))
    if not ranked:
        return None
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return ranked[0][2] if ranked[0][0] >= 5 else None


async def _form_locator_after(page, identity: dict, configured_selector: str):
    candidates = []
    if configured_selector:
        candidates.append(page.locator(configured_selector).first)
    if identity.get("id"):
        candidates.append(page.locator(f'form[id="{identity["id"]}"]').first)
    if identity.get("name"):
        candidates.append(page.locator(f'form[name="{identity["name"]}"]').first)
    for candidate in candidates:
        try:
            if await candidate.count() > 0:
                return candidate
        except Exception:
            continue
    form_index = int(identity.get("form_index") or -1)
    if form_index >= 0:
        candidate = page.locator("form").nth(form_index)
        if await candidate.count() > 0:
            return candidate
    return None


async def _form_value_state(form_locator) -> dict:
    if form_locator is None:
        return {"filled_count": 0, "control_count": 0}
    try:
        return await form_locator.evaluate(
            """form => {
              const controls = Array.from(form.querySelectorAll('input, select, textarea'));
              const business = controls.filter(element => {
                const type = String(element.getAttribute('type') || '').toLowerCase();
                return !['hidden', 'submit', 'button', 'reset'].includes(type);
              });
              const filled = business.filter(element => {
                if (['checkbox', 'radio'].includes(String(element.type || '').toLowerCase())) {
                  return Boolean(element.checked);
                }
                return String(element.value || '').trim().length > 0;
              });
              return { control_count: business.length, filled_count: filled.length };
            }"""
        )
    except Exception:
        return {"filled_count": 0, "control_count": 0}


async def _scoped_message_candidates(scope_locator) -> list[dict]:
    if scope_locator is None:
        return []
    try:
        return await scope_locator.evaluate(
            """root => {
              const selectors = [
                '[role="alert"]',
                '[role="status"]',
                '[aria-live]',
                '.error',
                '.errors',
                '.invalid-feedback',
                '.form-error',
                '.message',
                '.messages',
                '.alert',
                '.success',
                '.confirmation',
                '[class*="error"]',
                '[class*="invalid"]',
                '[class*="success"]',
                '[class*="confirm"]'
              ];
              const nodes = Array.from(new Set(selectors.flatMap(selector => {
                try { return Array.from(root.querySelectorAll(selector)); }
                catch { return []; }
              })));
              return nodes
                .filter(element => {
                  const style = window.getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return style.display !== 'none' && style.visibility !== 'hidden'
                    && rect.width > 0 && rect.height > 0;
                })
                .map((element, index) => {
                  const id = element.id ? `#${CSS.escape(element.id)}` : '';
                  const role = element.getAttribute('role') || '';
                  const className = typeof element.className === 'string' ? element.className : '';
                  return {
                    text: String(element.innerText || element.textContent || '').trim().slice(0, 500),
                    selector: id || `${element.tagName.toLowerCase()}:nth-message(${index + 1})`,
                    role,
                    class_name: className.slice(0, 200),
                    source: 'scoped_dom'
                  };
                })
                .filter(item => item.text.length >= 3)
                .slice(0, 30);
            }"""
        )
    except Exception:
        return []


def _message_candidate_diff(
    before_candidates: list[dict],
    after_candidates: list[dict],
    added_text_snippets: list[str],
) -> list[dict]:
    before_by_location: dict[tuple[str, str], str] = {}
    before_texts: set[str] = set()
    for candidate in before_candidates:
        normalized = normalize_semantic_text(candidate.get("text"))
        if not normalized:
            continue
        location = (
            str(candidate.get("selector") or ""),
            str(candidate.get("role") or ""),
        )
        before_by_location[location] = normalized
        before_texts.add(normalized)

    changed_candidates: list[dict] = []
    seen_texts: set[str] = set()
    for candidate in after_candidates:
        normalized = normalize_semantic_text(candidate.get("text"))
        if not normalized or normalized in seen_texts:
            continue
        location = (
            str(candidate.get("selector") or ""),
            str(candidate.get("role") or ""),
        )
        previous = before_by_location.get(location)
        is_new = normalized not in before_texts
        is_changed = previous is not None and previous != normalized
        if not is_new and not is_changed:
            continue
        seen_texts.add(normalized)
        changed_candidates.append(
            {
                **candidate,
                "normalized_text": normalized,
                "is_new": is_new,
                "is_changed": is_changed,
            }
        )

    for snippet in added_text_snippets:
        normalized = normalize_semantic_text(snippet)
        if not normalized or normalized in seen_texts or normalized in before_texts:
            continue
        seen_texts.add(normalized)
        changed_candidates.append(
            {
                "text": snippet,
                "normalized_text": normalized,
                "selector": "",
                "role": "",
                "class_name": "",
                "source": "added_text",
                "is_new": True,
                "is_changed": False,
            }
        )
    return changed_candidates[:30]


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    selector = node.config.get("selector") or DEFAULT_SELECTOR
    before_url = page.url
    before_network_count = len(context.network_events)
    configured_form_selector = str(node.config.get("form_selector") or "")
    effective_form_selector = configured_form_selector or str(
        getattr(context, "selected_form_selector", "") or ""
    )
    submit_locator = page.locator(str(selector)).first
    if effective_form_selector:
        global_matches_form = False
        try:
            if await submit_locator.count() > 0:
                global_matches_form = bool(
                    await submit_locator.evaluate(
                        """(element, formSelector) => {
                          const selected = document.querySelector(formSelector);
                          return !selected || element.closest('form') === selected;
                        }""",
                        effective_form_selector,
                    )
                )
        except Exception:
            global_matches_form = False
        if not global_matches_form:
            submit_locator = (
                page.locator(effective_form_selector)
                .first.locator(str(selector))
                .first
            )
    submitted_form = (
        page.locator(effective_form_selector).first
        if effective_form_selector
        else submit_locator.locator("xpath=ancestor::form[1]")
    )
    if await submitted_form.count() == 0:
        submitted_form = submit_locator.locator("xpath=ancestor-or-self::form[1]")
    form_identity = await submit_locator.evaluate(
        """element => {
          const form = element.closest('form');
          if (!form) return null;
          const forms = Array.from(document.forms);
          const parent = form.parentElement;
          if (parent) {
            parent.setAttribute('data-snapflow-form-zone', 'submitted');
          }
          return {
            id: form.id || '',
            name: form.getAttribute('name') || '',
            action: form.action || form.getAttribute('action') || '',
            method: (form.method || 'GET').toUpperCase(),
            form_index: forms.indexOf(form),
            parent_id: parent && parent.id ? parent.id : '',
            parent_selector: parent ? '[data-snapflow-form-zone="submitted"]' : '',
          };
        }"""
    )
    form_identity = form_identity if isinstance(form_identity, dict) else {}
    before_text = (
        (await submitted_form.inner_text())[:20_000]
        if await submitted_form.count() > 0
        else (await page.locator("body").inner_text())[:20_000]
    )
    before_value_state = await _form_value_state(
        submitted_form if await submitted_form.count() > 0 else None
    )
    parent_before_text = ""
    before_message_candidates: list[dict] = []
    try:
        if await submitted_form.count() > 0:
            before_message_scope = submitted_form.locator("xpath=..")
            parent_before_text = (await before_message_scope.inner_text())[:20_000]
            before_message_candidates = await _scoped_message_candidates(
                before_message_scope
            )
        elif form_identity.get("parent_id"):
            before_message_scope = page.locator(
                f'[id="{form_identity["parent_id"]}"]'
            ).first
            parent_before_text = (await before_message_scope.inner_text())[:20_000]
            before_message_candidates = await _scoped_message_candidates(
                before_message_scope
            )
    except Exception:
        parent_before_text = ""
        before_message_candidates = []
    await submit_locator.click(timeout=context.settings.node_timeout_ms)
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=context.settings.node_timeout_ms)
    except Exception:
        pass
    await page.wait_for_timeout(context.settings.settle_ms)
    form_after = await _form_locator_after(page, form_identity, effective_form_selector)
    form_present_after = form_after is not None
    scoped_after_text = ""
    if form_after is not None:
        try:
            scoped_after_text = (
                await form_after.locator("xpath=..").inner_text()
            )[:20_000]
        except Exception:
            try:
                scoped_after_text = (await form_after.inner_text())[:20_000]
            except Exception:
                scoped_after_text = ""
    if not scoped_after_text and form_identity.get("parent_id"):
        try:
            scoped_after_text = (
                await page.locator(f'[id="{form_identity["parent_id"]}"]').first.inner_text()
            )[:20_000]
        except Exception:
            scoped_after_text = ""
    if not scoped_after_text and form_identity.get("parent_selector"):
        try:
            scoped_after_text = (
                await page.locator(str(form_identity["parent_selector"])).first.inner_text()
            )[:20_000]
        except Exception:
            scoped_after_text = ""
    if not scoped_after_text:
        scoped_after_text = (await page.locator("body").inner_text())[:20_000]
    comparison_before_text = parent_before_text or before_text
    after_text = _repair_text(scoped_after_text)
    added_text_snippets = _added_text_snippets(comparison_before_text, after_text)
    message_scope = None
    if form_after is not None:
        message_scope = form_after.locator("xpath=..")
    elif form_identity.get("parent_id"):
        parent_locator = page.locator(f'[id="{form_identity["parent_id"]}"]').first
        if await parent_locator.count() > 0:
            message_scope = parent_locator
    elif form_identity.get("parent_selector"):
        parent_locator = page.locator(str(form_identity["parent_selector"])).first
        if await parent_locator.count() > 0:
            message_scope = parent_locator
    after_message_candidates = await _scoped_message_candidates(message_scope)
    message_candidates = _message_candidate_diff(
        before_message_candidates,
        after_message_candidates,
        added_text_snippets,
    )
    semantic_messages = classify_message_evidence(message_candidates)
    network_events = context.network_events[before_network_count:]
    invalid_controls = (
        form_after.locator("input:invalid, select:invalid, textarea:invalid")
        if form_after is not None
        else page.locator("input:invalid, select:invalid, textarea:invalid")
    )
    invalid_count = await invalid_controls.count()
    all_invalid_count = await page.locator("input:invalid, select:invalid, textarea:invalid").count()
    validation_messages: list[str] = []
    invalid_control_details: list[dict] = []
    for index in range(min(invalid_count, 10)):
        try:
            detail = await invalid_controls.nth(index).evaluate(
                """element => ({
                  id: element.id || '',
                  name: element.getAttribute('name') || '',
                  type: element.getAttribute('type') || element.tagName.toLowerCase(),
                  validation_message: element.validationMessage || '',
                })"""
            )
            detail = detail if isinstance(detail, dict) else {}
            matched_field = _field_for_invalid_control(detail, context.snapshot.fields)
            detail["field_id"] = matched_field.id if matched_field else None
            detail["field_name"] = matched_field.field_name if matched_field else str(detail.get("name") or "")
            detail["field_selector"] = matched_field.field_selector if matched_field else ""
            detail["field_key"] = _stable_field_key(
                detail["field_name"],
                detail["field_selector"],
                str(detail.get("type") or ""),
            )
            invalid_control_details.append(detail)
            message = str(detail.get("validation_message") or "")
            if message:
                validation_messages.append(message)
        except Exception:
            continue

    before_normalized = normalize_semantic_text(comparison_before_text)
    after_normalized = normalize_semantic_text(after_text)
    dom_changed = before_normalized != after_normalized
    observable_effect = before_url != page.url or dom_changed or bool(network_events)
    submission_response = _submission_response(
        network_events,
        action_url=str(form_identity.get("action") or node.config.get("form_action") or ""),
        method=str(form_identity.get("method") or node.config.get("form_method") or "GET"),
        page_url=before_url,
    )
    last_response = network_events[-1] if network_events else context.last_response
    response_status = int((submission_response or {}).get("status") or 0)
    after_value_state = await _form_value_state(form_after)
    if form_after is None:
        form_lifecycle = "replaced" if after_normalized else "removed"
    elif (
        int(before_value_state.get("filled_count") or 0) > 0
        and int(after_value_state.get("filled_count") or 0) == 0
    ):
        form_lifecycle = "reset"
    else:
        form_lifecycle = "retained"
    observation = {
        "selector": selector,
        "before_url": before_url,
        "final_url": page.url,
        "url_changed": before_url != page.url,
        "dom_changed": dom_changed,
        "observable_effect": observable_effect,
        "network_events": network_events[:20],
        "last_response": last_response,
        "submission_response": submission_response,
        "response_status": response_status,
        "form_invalid": invalid_count > 0,
        "invalid_control_count": invalid_count,
        "invalid_controls": invalid_control_details,
        "unrelated_invalid_control_count": max(0, all_invalid_count - invalid_count),
        "validation_messages": validation_messages,
        "form_present_after": form_present_after,
        "after_text": after_text,
        "added_text_snippets": added_text_snippets,
        "confirmation_snippets": added_text_snippets,
        "semantic_dom": {
            **semantic_messages,
            "form_lifecycle": form_lifecycle,
            "message_candidates": message_candidates[:20],
        },
        "submitted_form": {
            "selector": effective_form_selector,
            "action_url": str(form_identity.get("action") or node.config.get("form_action") or ""),
            "method": str(form_identity.get("method") or node.config.get("form_method") or "GET"),
            "form_index": form_identity.get("form_index"),
            "field_fingerprint": node.config.get("field_fingerprint") or [],
        },
    }
    context.last_submission = observation

    case_definition = (
        context.snapshot.case_definition
        if isinstance(context.snapshot.case_definition, dict)
        else {}
    )
    if int(case_definition.get("plan_version") or 0) >= 2:
        return StepOutcome(
            output={
                key: value
                for key, value in observation.items()
                if key != "after_text"
            }
        )

    if context.snapshot.expected_outcome == "validation_error" and invalid_count > 0:
        assertion = {
            "label": "Validation du formulaire attendue",
            "expected": "Le navigateur ou le formulaire bloque les donnees invalides",
            "actual": f"{invalid_count} champ(s) invalide(s)",
            "passed": True,
        }
        return StepOutcome(
            status="passed",
            output={
                **{
                    key: value
                    for key, value in observation.items()
                    if key != "after_text"
                },
                "expected_validation_observed": True,
            },
            assertions=[assertion],
        )

    if not observable_effect:
        error_code = "form_validation_blocked" if invalid_count > 0 else "submit_no_observable_effect"
        return StepOutcome(
            status="failed",
            output={
                "selector": selector,
                "before_url": before_url,
                "final_url": page.url,
                "url_changed": False,
                "dom_changed": False,
                "network_events": [],
                "form_invalid": invalid_count > 0,
                "invalid_control_count": invalid_count,
                "validation_messages": validation_messages,
            },
            error_code=error_code,
            error_message=(
                "The form was blocked by client-side validation."
                if invalid_count > 0
                else "The submit action produced no URL, DOM, or network change."
            ),
        )

    if context.snapshot.expected_outcome == "validation_error":
        assertion = {
            "label": "Validation du formulaire attendue",
            "expected": "La soumission doit etre refusee",
            "actual": "La soumission a produit un effet observable",
            "passed": False,
        }
        return StepOutcome(
            status="failed",
            output={
                "selector": selector,
                "before_url": before_url,
                "final_url": page.url,
                "url_changed": before_url != page.url,
                "dom_changed": before_text != after_text,
                "network_events": network_events[:20],
                "last_response": last_response,
                "form_invalid": invalid_count > 0,
                "invalid_control_count": invalid_count,
                "validation_messages": validation_messages,
                "expected_validation_observed": False,
            },
            assertions=[assertion],
            error_code="expected_validation_error_not_observed",
            error_message="The form accepted data that the scenario expected to reject.",
        )

    if context.snapshot.expected_outcome == "server_error":
        matched = response_status >= 500
        assertion = {
            "label": "Erreur serveur attendue",
            "expected": "HTTP >= 500",
            "actual": str(response_status or "aucune reponse"),
            "passed": matched,
        }
        return StepOutcome(
            status="passed" if matched else "failed",
            output={
                "selector": selector,
                "before_url": before_url,
                "final_url": page.url,
                "url_changed": before_url != page.url,
                "dom_changed": before_text != after_text,
                "network_events": network_events[:20],
                "last_response": last_response,
                "expected_server_error_observed": matched,
            },
            assertions=[assertion],
            error_code=None if matched else "expected_server_error_not_observed",
            error_message=None if matched else "The expected server error was not observed.",
        )

    if response_status >= 500:
        return StepOutcome(
            status="failed",
            output={
                "selector": selector,
                "before_url": before_url,
                "final_url": page.url,
                "network_events": network_events[:20],
                "last_response": last_response,
            },
            error_code="submit_server_error",
            error_message=f"The form submission returned HTTP {response_status}.",
        )

    return StepOutcome(
        output={
            "selector": selector,
            "before_url": before_url,
            "final_url": page.url,
            "url_changed": before_url != page.url,
            "dom_changed": before_text != after_text,
            "network_events": network_events[:20],
            "last_response": last_response,
            "form_invalid": invalid_count > 0,
            "invalid_control_count": invalid_count,
            "validation_messages": validation_messages,
        }
    )
