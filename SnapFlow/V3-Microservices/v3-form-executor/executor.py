from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from playwright.async_api import Browser, Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError

from challenge_resolver import detect_challenge, resolve_captcha
from business_verdict import build_business_summary
from models import (
    SUPPORTED_NODE_TYPES,
    ExecutionOutcome,
    ExecutionRecord,
    FieldDefinition,
    NodeDefinition,
    ScenarioSnapshot,
    StepOutcome,
)
from nodes import HANDLERS
from nodes.common import element_metadata, handler_type_from_element, resolve_field_selector
from redaction import redact
from semantic_observation import build_semantic_signature
from settings import Settings
from storage import Storage

logger = logging.getLogger("form-executor.executor")


class GraphValidationError(RuntimeError):
    pass


EDGE_BRANCH_KEYS = {"default", "success", "failure", "true", "false"}

CAPTCHA_PROVIDER_CONFIGURATION_ERRORS = frozenset(
    {
        "ERROR_ZERO_BALANCE",
        "ERROR_KEY_DOES_NOT_EXIST",
        "ERROR_IP_NOT_ALLOWED",
        "ERROR_ACCOUNT_SUSPENDED",
    }
)


def _baseline_signature(submission: dict[str, Any] | None) -> dict[str, Any]:
    observation = submission or {}
    return {
        **build_semantic_signature(observation),
        "response_status": observation.get("response_status"),
        "url_changed": bool(observation.get("url_changed")),
        "dom_changed": bool(observation.get("dom_changed")),
        "form_present_after": observation.get("form_present_after"),
        "invalid_control_count": int(observation.get("invalid_control_count") or 0),
        "validation_messages": [
            str(item)[:240] for item in (observation.get("validation_messages") or [])[:5]
        ],
        "added_text_snippets": [
            str(item)[:240] for item in (observation.get("added_text_snippets") or [])[:5]
        ],
        "network_events": [
            {
                "method": item.get("method"),
                "status": item.get("status"),
                "url": str(item.get("url") or "")[:500],
            }
            for item in (observation.get("network_events") or [])[:10]
            if isinstance(item, dict)
        ],
    }


def _submission_observation_summary(
    submission: dict[str, Any] | None,
) -> dict[str, Any]:
    observation = submission or {}
    semantic = (
        observation.get("semantic_dom")
        if isinstance(observation.get("semantic_dom"), dict)
        else {}
    )
    return {
        "submission_response": observation.get("submission_response"),
        "final_url": str(observation.get("final_url") or "")[:500],
        "url_changed": bool(observation.get("url_changed")),
        "dom_changed": bool(observation.get("dom_changed")),
        "form_present_after": observation.get("form_present_after"),
        "invalid_control_count": int(observation.get("invalid_control_count") or 0),
        "invalid_controls": [
            {
                "field_name": item.get("field_name"),
                "field_selector": item.get("field_selector"),
                "validation_message": str(item.get("validation_message") or "")[:300],
            }
            for item in (observation.get("invalid_controls") or [])[:10]
            if isinstance(item, dict)
        ],
        "semantic_dom": {
            "form_lifecycle": semantic.get("form_lifecycle"),
            "success_messages": (semantic.get("success_messages") or [])[:8],
            "validation_messages": (semantic.get("validation_messages") or [])[:8],
            "rejection_messages": (semantic.get("rejection_messages") or [])[:8],
        },
    }


def _captcha_failure_status(captcha_error_code: str | None) -> str:
    if captcha_error_code in CAPTCHA_PROVIDER_CONFIGURATION_ERRORS:
        return "error"
    return "blocked"


@dataclass
class ExecutionContext:
    execution: ExecutionRecord
    snapshot: ScenarioSnapshot
    settings: Settings
    fixture_root: str
    last_response: dict[str, Any] | None = None
    network_events: list[dict[str, Any]] = field(default_factory=list)
    network_failures: list[dict[str, Any]] = field(default_factory=list)
    console_events: list[dict[str, Any]] = field(default_factory=list)
    last_submission: dict[str, Any] | None = None
    captcha_solved: bool = False
    selected_form_selector: str | None = None


def validate_graph(snapshot: ScenarioSnapshot) -> None:
    if not snapshot.target_url:
        raise GraphValidationError("workflow_target_url_missing")
    if not snapshot.nodes:
        raise GraphValidationError("scenario_has_no_nodes")

    node_ids = [node.id for node in snapshot.nodes]
    if any(not node_id for node_id in node_ids) or len(set(node_ids)) != len(node_ids):
        raise GraphValidationError("scenario_node_ids_invalid")

    unsupported = sorted({node.type for node in snapshot.nodes if node.type not in SUPPORTED_NODE_TYPES})
    if unsupported:
        raise GraphValidationError(f"unsupported_node_types:{','.join(unsupported)}")

    known = set(node_ids)
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming_count: dict[str, int] = {node_id: 0 for node_id in node_ids}
    outgoing_edges: dict[str, list[Any]] = {node_id: [] for node_id in node_ids}
    for edge in snapshot.edges:
        if edge.source_node_id not in known or edge.target_node_id not in known:
            raise GraphValidationError("edge_references_unknown_node")
        if edge.branch_key not in EDGE_BRANCH_KEYS:
            raise GraphValidationError(f"edge_branch_key_invalid:{edge.branch_key}")
        adjacency[edge.source_node_id].append(edge.target_node_id)
        outgoing_edges[edge.source_node_id].append(edge)
        incoming_count[edge.target_node_id] += 1

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise GraphValidationError("scenario_graph_cycle_detected")
        if node_id in visited:
            return
        visiting.add(node_id)
        for target in adjacency[node_id]:
            visit(target)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in node_ids:
        visit(node_id)

    if snapshot.edges:
        roots = [node_id for node_id, count in incoming_count.items() if count == 0]
        if len(roots) != 1:
            raise GraphValidationError(f"scenario_graph_root_count:{len(roots)}")

    for node in snapshot.nodes:
        edges = outgoing_edges[node.id]
        branch_keys = [edge.branch_key for edge in edges]
        if len(branch_keys) != len(set(branch_keys)):
            raise GraphValidationError(f"duplicate_branch_key:{node.id}")

        if node.type == "condition":
            if len(edges) > 2:
                raise GraphValidationError(f"condition_too_many_edges:{node.id}")
            invalid_keys = set(branch_keys) - {"true", "false", "default"}
            if invalid_keys:
                raise GraphValidationError(f"condition_branch_key_invalid:{node.id}")
            for key in ("true_node_id", "false_node_id"):
                target_id = node.config.get(key)
                if target_id and target_id not in known:
                    raise GraphValidationError(f"condition_target_unknown:{node.id}:{key}")
        else:
            if len(edges) > 2:
                raise GraphValidationError(f"node_too_many_edges:{node.id}")
            invalid_keys = set(branch_keys) - {"default", "success", "failure"}
            if invalid_keys:
                raise GraphValidationError(f"node_branch_key_invalid:{node.id}")
            if len(edges) == 2 and set(branch_keys) != {"success", "failure"}:
                raise GraphValidationError(f"node_branch_pair_invalid:{node.id}")

    field_nodes = {field.node_id for field in snapshot.fields}
    missing_fields = [
        node.id
        for node in snapshot.nodes
        if node.type == "form_fill" and node.id not in field_nodes
    ]
    if missing_fields:
        raise GraphValidationError(f"form_fill_field_missing:{','.join(missing_fields)}")


def build_execution_plan(
    snapshot: ScenarioSnapshot,
    mode: str,
    start_node_id: str | None,
) -> list[tuple[NodeDefinition, bool]]:
    nodes = snapshot.nodes
    if mode == "full" or mode == "scheduled":
        return [(node, True) for node in nodes]
    if not start_node_id:
        raise GraphValidationError("start_node_id_required")

    target_index = next((index for index, node in enumerate(nodes) if node.id == start_node_id), None)
    if target_index is None:
        raise GraphValidationError("start_node_not_found")
    if mode == "step":
        return [(node, index == target_index) for index, node in enumerate(nodes[: target_index + 1])]
    if mode == "from_step":
        return [(node, index >= target_index) for index, node in enumerate(nodes)]
    raise GraphValidationError(f"execution_mode_unsupported:{mode}")


def _graph_indexes(
    snapshot: ScenarioSnapshot,
) -> tuple[dict[str, NodeDefinition], dict[str, list[Any]], dict[str, int]]:
    nodes_by_id = {node.id: node for node in snapshot.nodes}
    outgoing: dict[str, list[Any]] = {node.id: [] for node in snapshot.nodes}
    incoming_count = {node.id: 0 for node in snapshot.nodes}
    for edge in snapshot.edges:
        outgoing[edge.source_node_id].append(edge)
        incoming_count[edge.target_node_id] += 1
    return nodes_by_id, outgoing, incoming_count


def _root_node(snapshot: ScenarioSnapshot, incoming_count: dict[str, int]) -> NodeDefinition:
    if not snapshot.edges:
        return snapshot.nodes[0]
    root_ids = [node_id for node_id, count in incoming_count.items() if count == 0]
    if len(root_ids) != 1:
        raise GraphValidationError(f"scenario_graph_root_count:{len(root_ids)}")
    nodes_by_id = {node.id: node for node in snapshot.nodes}
    return nodes_by_id[root_ids[0]]


def _fallback_order_target(snapshot: ScenarioSnapshot, node: NodeDefinition) -> str | None:
    node_index = next((index for index, item in enumerate(snapshot.nodes) if item.id == node.id), None)
    if node_index is None or node_index + 1 >= len(snapshot.nodes):
        return None
    return snapshot.nodes[node_index + 1].id


def _edge_target(edges: list[Any], branch_keys: tuple[str, ...]) -> str | None:
    for branch_key in branch_keys:
        match = next((edge for edge in edges if edge.branch_key == branch_key), None)
        if match:
            return match.target_node_id
    return None


def _next_node_id(
    snapshot: ScenarioSnapshot,
    node: NodeDefinition,
    outcome: StepOutcome,
    outgoing: dict[str, list[Any]],
) -> tuple[str | None, str | None]:
    edges = outgoing.get(node.id, [])
    if outcome.status == "passed" and outcome.output.get("expected_block_observed"):
        return None, "expected_outcome"
    if (
        node.type == "submit"
        and outcome.status == "passed"
        and (
            outcome.output.get("expected_validation_observed")
            or outcome.output.get("expected_server_error_observed")
        )
    ):
        return None, "expected_outcome"

    if node.type == "condition" and outcome.status == "passed":
        matched = bool(outcome.output.get("matched"))
        branch = "true" if matched else "false"
        target = _edge_target(edges, (branch,))
        if not target:
            config_key = "true_node_id" if matched else "false_node_id"
            target = str(node.config.get(config_key) or "") or None
        if not target:
            target = _edge_target(edges, ("default",))
        return target, branch

    if outcome.status in {"passed", "skipped"}:
        target = _edge_target(edges, ("success", "default"))
        if not target and not snapshot.edges:
            target = _fallback_order_target(snapshot, node)
        return target, "success"

    target = _edge_target(edges, ("failure",))
    return target, "failure" if target else None


class FormExecutor:
    def __init__(self, settings: Settings, storage: Storage, browser: Browser):
        self.settings = settings
        self.storage = storage
        self.browser = browser
        self._runtime_state: dict[str, dict[str, Any]] = {}
        self._last_timeout_state: dict[str, dict[str, Any]] = {}

    def estimate_execution_budget_ms(self, execution: ExecutionRecord) -> int:
        snapshot = self.storage.load_snapshot(execution)
        interaction_budget = max(
            self.settings.node_timeout_ms,
            len(snapshot.nodes) * 4_000,
        )
        captcha_budget = (
            self.settings.captcha_timeout_s * 1_000
            if self.settings.captcha_api_key
            else 0
        )
        estimated = (
            self.settings.navigation_timeout_ms
            + interaction_budget
            + captcha_budget
            + 15_000
        )
        return min(
            self.settings.execution_timeout_max_ms,
            max(self.settings.execution_timeout_ms, estimated),
        )

    def set_execution_budget(self, execution_id: str, budget_ms: int) -> None:
        state = self._runtime_state.setdefault(execution_id, {})
        state["budget_ms"] = budget_ms
        state["started_at"] = time.monotonic()

    def timeout_context(self, execution_id: str) -> dict[str, Any]:
        state = self._runtime_state.get(execution_id) or self._last_timeout_state.get(
            execution_id, {}
        )
        started_at = float(state.get("started_at") or time.monotonic())
        budget_ms = int(state.get("budget_ms") or self.settings.execution_timeout_ms)
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        return {
            "budget_ms": budget_ms,
            "elapsed_ms": elapsed_ms,
            "remaining_ms": max(0, budget_ms - elapsed_ms),
            "timeout_phase": state.get("phase"),
            "current_node_id": state.get("current_node_id"),
        }

    def _field_for_node(self, snapshot: ScenarioSnapshot, node_id: str) -> FieldDefinition | None:
        return next((field for field in snapshot.fields if field.node_id == node_id), None)

    async def _infer_selected_form_selector(
        self,
        page,
        snapshot: ScenarioSnapshot,
    ) -> str | None:
        submit_node = next(
            (node for node in snapshot.nodes if node.type == "submit"),
            None,
        )
        configured = (
            str(submit_node.config.get("form_selector") or "")
            if submit_node
            else ""
        )
        if configured:
            try:
                if await page.locator(configured).count() > 0:
                    await page.locator(configured).first.evaluate(
                        "element => element.setAttribute('data-snapflow-selected-form', 'true')"
                    )
                    return 'form[data-snapflow-selected-form="true"]'
            except Exception:
                pass
        selectors = [
            field.field_selector
            for field in snapshot.fields
            if field.field_selector
        ]
        return await page.evaluate(
            """selectors => {
              const counts = new Map();
              for (const selector of selectors) {
                try {
                  const element = document.querySelector(selector);
                  const form = element && element.closest('form');
                  if (form) counts.set(form, (counts.get(form) || 0) + 1);
                } catch (_) {}
              }
              const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
              const selected = ranked[0] && ranked[0][0];
              if (!selected) return null;
              selected.setAttribute('data-snapflow-selected-form', 'true');
              return 'form[data-snapflow-selected-form="true"]';
            }""",
            selectors,
        )

    async def _field_belongs_to_selected_form(
        self,
        page,
        field: FieldDefinition,
        selected_form_selector: str | None,
    ) -> bool:
        if not selected_form_selector or not field.field_selector:
            return True
        locator = page.locator(field.field_selector).first
        if await locator.count() == 0:
            return True
        try:
            return bool(
                await locator.evaluate(
                    """(element, selectedSelector) => {
                      const selected = document.querySelector(selectedSelector);
                      return !selected || element.closest('form') === selected;
                    }""",
                    selected_form_selector,
                )
            )
        except Exception:
            return True

    async def _handler_type(self, page, node: NodeDefinition, field: FieldDefinition | None) -> tuple[str, dict[str, Any]]:
        if node.type != "form_fill":
            return node.type, {}
        if not field:
            return "fill", {}

        metadata: dict[str, Any] = {}
        if field.field_selector:
            try:
                metadata = await element_metadata(page, field.field_selector)
                element_handler = handler_type_from_element(metadata)
                if element_handler:
                    return element_handler, metadata
            except Exception as exc:
                metadata = {"selector": field.field_selector, "metadata_error": str(exc)}

        if field.field_type == "select":
            return "select", metadata
        if field.field_type in {"checkbox", "radio"}:
            return "check", metadata
        if field.field_type == "file":
            return "upload", metadata
        return "fill", metadata

    async def _redacted_screenshot(
        self,
        page,
        snapshot: ScenarioSnapshot,
        *,
        full_page: bool = False,
    ) -> bytes:
        masked: list[tuple[Any, str | None]] = []
        for field in snapshot.fields:
            if not field.field_selector:
                continue
            if not (field.is_sensitive or field.field_type in {"password", "email", "tel"}):
                continue
            locator = page.locator(field.field_selector).first
            if await locator.count() == 0:
                continue
            try:
                original = await locator.input_value()
                await locator.evaluate(
                    """element => {
                      if ('value' in element) element.value = '[REDACTED]';
                      element.setAttribute('data-snapflow-redacted', 'true');
                    }"""
                )
                masked.append((locator, original))
            except Exception:
                continue
        try:
            return await page.screenshot(full_page=full_page)
        finally:
            for locator, original in masked:
                try:
                    await locator.evaluate(
                        """(element, value) => {
                          if ('value' in element) element.value = value || '';
                          element.removeAttribute('data-snapflow-redacted');
                        }""",
                        original,
                    )
                except Exception:
                    pass

    async def execute(self, execution: ExecutionRecord) -> ExecutionOutcome:
        started = time.monotonic()
        snapshot = self.storage.load_snapshot(execution)
        load_campaign_context = getattr(self.storage, "load_campaign_context", None)
        campaign_context = (
            load_campaign_context(execution.id)
            if callable(load_campaign_context)
            else {}
        )
        validate_graph(snapshot)
        plan = build_execution_plan(snapshot, execution.execution_mode, execution.start_node_id)
        nodes_by_id, outgoing, incoming_count = _graph_indexes(snapshot)
        current_node: NodeDefinition | None = _root_node(snapshot, incoming_count)
        recording_started = execution.execution_mode in {"full", "scheduled"}
        requested_node_reached = recording_started
        sensitive_values = {
            field.value
            for field in snapshot.fields
            if field.value and (field.is_sensitive or field.field_type in {"password", "email", "tel"})
        }
        fixture_root = str(Path(__file__).resolve().parent / "tests" / "fixtures" / "uploads")
        context = ExecutionContext(
            execution=execution,
            snapshot=snapshot,
            settings=self.settings,
            fixture_root=fixture_root,
        )
        assertions: list[dict[str, Any]] = []
        recorded_steps = 0
        completed_steps = 0
        final_status = "passed"
        failure_reason: str | None = None
        executed_node_ids: list[str] = []
        handled_failure_node_ids: list[str] = []
        expected_outcome_observed = False
        latest_oracle: dict[str, Any] | None = None
        captcha_resolution_cache = {}

        browser_context = await self.browser.new_context(
            viewport={"width": 1366, "height": 768},
            ignore_https_errors=self.settings.ignore_https_errors,
            accept_downloads=False,
        )
        page = await browser_context.new_page()
        runtime_state = self._runtime_state.setdefault(execution.id, {})
        runtime_state.update(
            {
                "page": page,
                "snapshot": snapshot,
                "phase": "navigation",
                "current_node_id": current_node.id if current_node else None,
                "started_at": runtime_state.get("started_at") or started,
            }
        )
        page.set_default_timeout(self.settings.node_timeout_ms)
        page.set_default_navigation_timeout(self.settings.navigation_timeout_ms)

        def on_response(response) -> None:
            event = {
                "url": response.url,
                "status": response.status,
                "method": response.request.method,
                "resource_type": response.request.resource_type,
            }
            context.last_response = event
            if len(context.network_events) < self.settings.max_network_events:
                context.network_events.append(event)

        def on_request_failed(request) -> None:
            if len(context.network_failures) < self.settings.max_network_events:
                context.network_failures.append(
                    {
                        "url": request.url,
                        "method": request.method,
                        "resource_type": request.resource_type,
                        "failure": request.failure,
                    }
                )

        def on_console(message) -> None:
            if message.type in {"error", "warning"} and len(context.console_events) < self.settings.max_console_events:
                context.console_events.append({"type": message.type, "text": message.text})

        page.on("response", on_response)
        page.on("requestfailed", on_request_failed)
        page.on("console", on_console)

        self.storage.log(
            execution.id,
            "execution_started",
            "Execution Chromium demarree.",
            details={
                "mode": execution.execution_mode,
                "step_count": len(plan),
                "graph_node_count": len(snapshot.nodes),
                "expected_outcome": snapshot.expected_outcome,
            },
        )
        self.storage.update_progress(
            execution.id,
            0,
            len(snapshot.nodes),
            current_node.id if current_node else None,
        )

        try:
            while current_node is not None:
                node = current_node
                runtime_state["current_node_id"] = node.id
                runtime_state["phase"] = (
                    "captcha_or_navigation"
                    if node.type in {"trigger", "navigate"}
                    else "submission"
                    if node.type == "submit"
                    else "assertion"
                    if node.type in {"assert", "condition", "inspect_response"}
                    else "interaction"
                )
                if node.id in executed_node_ids:
                    raise GraphValidationError(f"scenario_graph_revisited_node:{node.id}")
                executed_node_ids.append(node.id)

                if node.id == execution.start_node_id:
                    requested_node_reached = True
                    if execution.execution_mode == "from_step":
                        recording_started = True

                if execution.execution_mode == "step":
                    should_record = node.id == execution.start_node_id
                elif execution.execution_mode == "from_step":
                    should_record = recording_started
                else:
                    should_record = True

                if self.storage.should_stop(execution.id):
                    final_status = "cancelled"
                    failure_reason = "stopped_by_user"
                    self.storage.log(execution.id, "execution_stopped", "Execution arretee par l utilisateur.")
                    break

                field = self._field_for_node(snapshot, node.id)
                if (
                    field
                    and context.selected_form_selector is None
                    and page.url
                    and page.url != "about:blank"
                ):
                    context.selected_form_selector = await self._infer_selected_form_selector(
                        page,
                        snapshot,
                    )
                selector_resolution = (
                    await resolve_field_selector(
                        page,
                        node,
                        field,
                        captcha_solved=context.captcha_solved,
                    )
                    if field
                    else None
                )
                if field and selector_resolution and selector_resolution.resolved_selector:
                    field = replace(field, field_selector=selector_resolution.resolved_selector)
                handler_type, element_info = await self._handler_type(page, node, field)
                handler = HANDLERS.get(handler_type)
                if not handler:
                    raise GraphValidationError(f"handler_missing:{handler_type}")

                input_data = {
                    "node_type": node.type,
                    "handler_type": handler_type,
                    "config": node.config,
                    "selector": field.field_selector if field else node.config.get("selector"),
                    "field_name": field.field_name if field else None,
                    "field_type": field.field_type if field else None,
                    "detected_element": element_info,
                    "value": field.value if field else node.config.get("value"),
                    "setup_only": not should_record,
                }
                if selector_resolution:
                    input_data.update(selector_resolution.diagnostics())
                step_id = (
                    self.storage.start_step(
                        execution.id,
                        node.id,
                        recorded_steps,
                        handler_type,
                        input_data,
                        sensitive_values,
                    )
                    if should_record
                    else None
                )
                if should_record:
                    recorded_steps += 1

                step_started = time.monotonic()
                outcome = StepOutcome()
                try:
                    field_outside_selected_form = bool(
                        field
                        and selector_resolution
                        and selector_resolution.resolved_selector
                        and not await self._field_belongs_to_selected_form(
                            page,
                            field,
                            context.selected_form_selector,
                        )
                    )
                    if field_outside_selected_form:
                        outcome = StepOutcome(
                            status="skipped",
                            output={
                                "skip_reason": "field_outside_selected_form",
                                "selected_form_selector": context.selected_form_selector,
                                **(
                                    selector_resolution.diagnostics()
                                    if selector_resolution
                                    else {}
                                ),
                            },
                        )
                    elif selector_resolution and selector_resolution.should_skip:
                        outcome = StepOutcome(
                            status="skipped",
                            output={
                                **selector_resolution.metadata,
                                **selector_resolution.diagnostics(),
                            },
                        )
                    else:
                        outcome = await handler(page, node, field, context)
                except PlaywrightTimeoutError as exc:
                    outcome = StepOutcome(
                        status="error",
                        error_code="playwright_timeout",
                        error_message=str(exc),
                    )
                except (PlaywrightError, ValueError) as exc:
                    outcome = StepOutcome(
                        status="error",
                        error_code="playwright_step_error" if isinstance(exc, PlaywrightError) else "step_validation_error",
                        error_message=str(exc),
                        output={
                            "node_id": node.id,
                            "handler_type": handler_type,
                            "selector": input_data.get("selector"),
                            "field_name": input_data.get("field_name"),
                            "field_type": input_data.get("field_type"),
                            "detected_element": element_info,
                        },
                    )
                except Exception as exc:
                    logger.exception("Unexpected node failure execution=%s node=%s", execution.id, node.id)
                    outcome = StepOutcome(
                        status="error",
                        error_code="unexpected_step_error",
                        error_message=str(exc),
                    )

                if selector_resolution:
                    outcome.output = {
                        **selector_resolution.diagnostics(),
                        **outcome.output,
                    }

                if isinstance(outcome.output.get("oracle"), dict):
                    latest_oracle = outcome.output["oracle"]

                if handler_type in {"trigger", "navigate", "submit"} and outcome.status == "passed":
                    challenge = await detect_challenge(page)
                    if challenge:
                        # When a block is expected, treat it as a passing assertion
                        if snapshot.expected_outcome == "blocked":
                            outcome = StepOutcome(
                                status="passed",
                                output={
                                    "challenge_type": challenge.challenge_type,
                                    "final_url": page.url,
                                    "expected_block_observed": True,
                                },
                                assertions=[
                                    {
                                        "label": "Blocage attendu",
                                        "expected": "Le parcours doit etre bloque",
                                        "actual": challenge.challenge_type,
                                        "passed": True,
                                    }
                                ],
                            )
                        elif challenge.challenge_type == "captcha" and challenge.captcha_info is not None:
                            captcha_info = challenge.captcha_info
                            captcha_result = await resolve_captcha(
                                page,
                                captcha_info,
                                cache=captcha_resolution_cache,
                            )
                            provider_details = {
                                "captcha_provider": "2captcha",
                                "captcha_task_id": captcha_result.task_id,
                                "captcha_task_type": captcha_result.task_type,
                                "captcha_provider_error_code": captcha_result.provider_error_code,
                                "captcha_provider_error_description": captcha_result.provider_error_description,
                            }
                            provider_details = {
                                key: value
                                for key, value in provider_details.items()
                                if value not in {None, ""}
                            }
                            if captcha_result.success:
                                context.captcha_solved = True
                                outcome.captcha_detected = True
                                outcome.captcha_type = captcha_info.captcha_type
                                outcome.captcha_solved = True
                                outcome.captcha_solve_duration_ms = captcha_result.solve_duration_ms
                                outcome.captcha_solve_cost = captcha_result.cost
                                outcome.output.update(
                                    {
                                        "captcha_resolved": True,
                                        "captcha_type": captcha_info.captcha_type,
                                        "final_url": page.url,
                                        **provider_details,
                                    }
                                )
                            else:
                                failure_status = _captcha_failure_status(
                                    captcha_result.provider_error_code
                                )
                                failure_kind = (
                                    "captcha_solver_unavailable"
                                    if failure_status == "error"
                                    else "captcha_unsolvable"
                                )
                                reason = (
                                    f"{failure_kind}:{captcha_info.captcha_type}:"
                                    f"{captcha_result.error or 'unknown'}"
                                )
                                outcome = StepOutcome(
                                    status=failure_status,
                                    output={
                                        "challenge_type": "captcha",
                                        "captcha_type": captcha_info.captcha_type,
                                        "final_url": page.url,
                                        "captcha_solve_attempted": (
                                            captcha_result.error != "no_captcha_api_key_configured"
                                        ),
                                        "blocked_reason": reason if failure_status == "blocked" else None,
                                        "error_reason": reason if failure_status == "error" else None,
                                        **provider_details,
                                    },
                                    error_code=reason,
                                    error_message=(
                                        f"CAPTCHA solver unavailable: {reason}"
                                        if failure_status == "error"
                                        else f"Execution blocked by CAPTCHA: {reason}"
                                    ),
                                    captcha_detected=True,
                                    captcha_type=captcha_info.captcha_type,
                                    captcha_solved=False,
                                    captcha_solve_duration_ms=captcha_result.solve_duration_ms or None,
                                    captcha_solve_cost=captcha_result.cost or None,
                                )
                        else:
                            # OTP or other unsupported challenge
                            outcome = StepOutcome(
                                status="blocked",
                                output={"challenge_type": challenge.challenge_type, "final_url": page.url},
                                error_code=challenge.reason,
                                error_message=f"Execution blocked by {challenge.challenge_type}",
                            )

                capture_evidence = (
                    handler_type in {
                        "trigger",
                        "navigate",
                        "submit",
                        "click",
                        "screenshot",
                        "assert",
                    }
                    or outcome.status in {"failed", "blocked", "error", "inconclusive"}
                )
                if capture_evidence:
                    try:
                        if outcome.status in {"failed", "blocked", "error", "inconclusive"}:
                            capture_reason = f"step_{outcome.status}"
                        elif handler_type == "assert":
                            capture_reason = "assertion"
                        elif handler_type == "submit":
                            capture_reason = "submission"
                        elif handler_type in {"trigger", "navigate"}:
                            capture_reason = "navigation"
                        else:
                            capture_reason = handler_type
                        screenshot = await self._redacted_screenshot(
                            page,
                            snapshot,
                            full_page=bool(outcome.output.get("full_page", False)),
                        )
                        self.storage.save_artifact(
                            execution.id,
                            step_id,
                            "screenshot",
                            screenshot,
                            "image/png",
                            {
                                "node_id": node.id,
                                "status": outcome.status,
                                "url": page.url,
                                "capture_reason": capture_reason,
                            },
                        )
                        if outcome.status in {"failed", "blocked", "error", "inconclusive"}:
                            html = await page.content()
                            redacted_html = redact(html, sensitive_values)
                            self.storage.save_artifact(
                                execution.id,
                                step_id,
                                "html_snapshot",
                                str(redacted_html).encode("utf-8", errors="replace"),
                                "text/html",
                                {
                                    "node_id": node.id,
                                    "status": outcome.status,
                                    "url": page.url,
                                    "capture_reason": capture_reason,
                                },
                            )
                    except Exception as exc:
                        logger.warning(
                            "Evidence capture failed execution=%s node=%s: %s",
                            execution.id,
                            node.id,
                            exc,
                        )
                        self.storage.log(
                            execution.id,
                            "evidence_capture_failed",
                            "La capture de preuve a echoue.",
                            level="warning",
                            step_result_id=step_id,
                            details={"node_id": node.id, "error": str(exc)},
                            sensitive_values=sensitive_values,
                        )

                if outcome.artifact:
                    artifact_type, content, mime_type = outcome.artifact
                    self.storage.save_artifact(
                        execution.id,
                        step_id,
                        artifact_type,
                        content,
                        mime_type,
                        {"node_id": node.id, "url": page.url},
                    )

                next_node_id, selected_branch = _next_node_id(
                    snapshot,
                    node,
                    outcome,
                    outgoing,
                )
                expected_outcome_observed = expected_outcome_observed or any(
                    bool(outcome.output.get(key))
                    for key in (
                        "expected_validation_observed",
                        "expected_server_error_observed",
                        "expected_block_observed",
                    )
                )
                if execution.execution_mode == "step" and node.id == execution.start_node_id:
                    next_node_id = None
                if selected_branch:
                    outcome.output["selected_branch"] = selected_branch
                if next_node_id:
                    outcome.output["next_node_id"] = next_node_id
                if outcome.status in {"failed", "blocked", "error"} and next_node_id:
                    outcome.output["handled_by_branch"] = True
                    handled_failure_node_ids.append(node.id)

                duration_ms = int((time.monotonic() - step_started) * 1000)
                assertions.extend(outcome.assertions)
                if step_id:
                    self.storage.finish_step(
                        step_id,
                        status=outcome.status,
                        duration_ms=duration_ms,
                        output={**outcome.output, "final_url": page.url},
                        assertions=outcome.assertions,
                        error_code=outcome.error_code,
                        error_message=outcome.error_message,
                        sensitive_values=sensitive_values,
                        captcha_detected=outcome.captcha_detected,
                        captcha_type=outcome.captcha_type,
                        captcha_solved=outcome.captcha_solved,
                        captcha_solve_duration_ms=outcome.captcha_solve_duration_ms,
                        captcha_solve_cost=outcome.captcha_solve_cost,
                    )
                    self.storage.log(
                        execution.id,
                        "step_completed",
                        f"Etape {handler_type} terminee avec le statut {outcome.status}.",
                        level="error" if outcome.status == "error" else "warning" if outcome.status in {"failed", "blocked", "inconclusive"} else "info",
                        step_result_id=step_id,
                        details={
                            "node_id": node.id,
                            "duration_ms": duration_ms,
                            "error_code": outcome.error_code,
                        },
                        sensitive_values=sensitive_values,
                    )

                completed_steps += 1
                self.storage.update_progress(
                    execution.id,
                    completed_steps,
                    len(snapshot.nodes),
                    next_node_id,
                )

                if outcome.status == "blocked" and not next_node_id:
                    final_status = "blocked"
                    failure_reason = outcome.error_code or "challenge_blocked"
                    break
                if outcome.status == "failed" and not next_node_id:
                    final_status = "failed"
                    failure_reason = outcome.error_code or "business_validation_failed"
                    break
                if outcome.status == "error" and not next_node_id:
                    final_status = "error"
                    failure_reason = outcome.error_code or "step_execution_error"
                    break
                if outcome.status == "inconclusive" and not next_node_id:
                    final_status = "inconclusive"
                    failure_reason = outcome.error_code or "submission_outcome_inconclusive"
                    break
                current_node = nodes_by_id.get(next_node_id) if next_node_id else None

            if completed_steps == 0 and final_status == "passed":
                final_status = "error"
                failure_reason = "no_step_executed"
            elif (
                execution.execution_mode in {"step", "from_step"}
                and not requested_node_reached
                and final_status == "passed"
            ):
                final_status = "error"
                failure_reason = "start_node_not_reached_on_runtime_branch"
            elif (
                snapshot.expected_outcome == "blocked"
                and final_status == "passed"
                and not expected_outcome_observed
            ):
                final_status = "failed"
                failure_reason = "expected_block_not_observed"

            network_summary = {
                "requests": len(context.network_events),
                "failures": len(context.network_failures),
                "last_response": context.last_response,
                "failed_requests": context.network_failures[:20],
                "console_event_count": len(context.console_events),
            }
            summary = {
                "engine": "chromium",
                "executed_steps": completed_steps,
                "recorded_steps": recorded_steps,
                "total_steps": len(snapshot.nodes),
                "executed_node_ids": executed_node_ids,
                "skipped_node_ids": [
                    node.id for node in snapshot.nodes if node.id not in executed_node_ids
                ],
                "handled_failure_node_ids": handled_failure_node_ids,
                "expected_outcome": snapshot.expected_outcome,
                "case_definition": snapshot.case_definition,
                "console_events": context.console_events[:20],
                "baseline_signature": _baseline_signature(context.last_submission),
                "submission_observation": _submission_observation_summary(
                    context.last_submission
                ),
            }
            summary.update(
                build_business_summary(
                    execution_status=final_status,
                    expected_outcome=snapshot.expected_outcome,
                    case_definition=snapshot.case_definition,
                    submission=context.last_submission or {},
                    oracle=latest_oracle,
                    campaign_context=campaign_context,
                )
            )
            timing = self.timeout_context(execution.id)
            summary["execution_timing"] = timing
            return ExecutionOutcome(
                status=final_status,
                final_url=page.url or None,
                duration_ms=int((time.monotonic() - started) * 1000),
                failure_reason=failure_reason,
                assertions=assertions,
                network_summary=network_summary,
                summary=summary,
            )
        except asyncio.CancelledError:
            timing = self.timeout_context(execution.id)
            self._last_timeout_state[execution.id] = dict(timing)
            try:
                screenshot = await self._redacted_screenshot(
                    page,
                    snapshot,
                    full_page=True,
                )
                self.storage.save_artifact(
                    execution.id,
                    None,
                    "screenshot",
                    screenshot,
                    "image/png",
                    {
                        "node_id": timing.get("current_node_id"),
                        "status": "error",
                        "url": page.url,
                        "capture_reason": "execution_timeout",
                        **timing,
                    },
                )
                html = await page.content()
                self.storage.save_artifact(
                    execution.id,
                    None,
                    "html_snapshot",
                    str(redact(html, sensitive_values)).encode(
                        "utf-8", errors="replace"
                    ),
                    "text/html",
                    {
                        "node_id": timing.get("current_node_id"),
                        "status": "error",
                        "url": page.url,
                        "capture_reason": "execution_timeout",
                        **timing,
                    },
                )
            except Exception as exc:
                logger.warning(
                    "Timeout evidence capture failed execution=%s: %s",
                    execution.id,
                    exc,
                )
            raise
        finally:
            self._runtime_state.pop(execution.id, None)
            await browser_context.close()
