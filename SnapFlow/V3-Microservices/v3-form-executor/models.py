from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


SUPPORTED_NODE_TYPES = {
    "trigger",
    "form_fill",
    "submit",
    "assert",
    "navigate",
    "fill",
    "select",
    "check",
    "upload",
    "click",
    "wait",
    "condition",
    "screenshot",
    "inspect_response",
}

SUPPORTED_FIELD_TYPES = {
    "text",
    "email",
    "tel",
    "password",
    "select",
    "checkbox",
    "radio",
    "textarea",
    "number",
    "date",
    "time",
    "url",
    "search",
    "file",
}


def normalize_field_type(value: object) -> str:
    raw = str(value or "").strip().lower()
    if raw in SUPPORTED_FIELD_TYPES:
        return raw
    if raw in {"", "true", "input"}:
        return "text"
    return "text"


@dataclass(frozen=True)
class FieldDefinition:
    id: str
    node_id: str
    field_name: str
    field_type: str
    field_selector: str
    required: bool = False
    user_value: str | None = None
    ai_suggestion: str | None = None
    is_sensitive: bool = False

    @property
    def value(self) -> str:
        if self.user_value is not None:
            return self.user_value
        return self.ai_suggestion or ""


@dataclass(frozen=True)
class NodeDefinition:
    id: str
    type: str
    order_index: int
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EdgeDefinition:
    source_node_id: str
    target_node_id: str
    branch_key: str = "default"


@dataclass(frozen=True)
class ScenarioSnapshot:
    target_url: str
    nodes: list[NodeDefinition]
    fields: list[FieldDefinition]
    edges: list[EdgeDefinition]
    expected_outcome: str = "success"
    case_definition: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "ScenarioSnapshot":
        workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
        scenario = payload.get("scenario") if isinstance(payload.get("scenario"), dict) else {}
        nodes = [
            NodeDefinition(
                id=str(item.get("id", "")),
                type=str(item.get("type", "")),
                order_index=int(item.get("order_index", index)),
                config=item.get("config") if isinstance(item.get("config"), dict) else {},
            )
            for index, item in enumerate(payload.get("nodes") or [])
            if isinstance(item, dict)
        ]
        fields = [
            FieldDefinition(
                id=str(item.get("id", "")),
                node_id=str(item.get("node_id", "")),
                field_name=str(item.get("field_name", "")),
                field_type=normalize_field_type(item.get("field_type")),
                field_selector=str(item.get("field_selector", "")),
                required=bool(item.get("required")),
                user_value=item.get("user_value") if isinstance(item.get("user_value"), str) else None,
                ai_suggestion=item.get("ai_suggestion") if isinstance(item.get("ai_suggestion"), str) else None,
                is_sensitive=bool(item.get("is_sensitive")),
            )
            for item in payload.get("fields") or []
            if isinstance(item, dict)
        ]
        edges = [
            EdgeDefinition(
                source_node_id=str(item.get("source_node_id", "")),
                target_node_id=str(item.get("target_node_id", "")),
                branch_key=str(item.get("branch_key") or "default"),
            )
            for item in payload.get("edges") or []
            if isinstance(item, dict)
        ]
        return cls(
            target_url=str(workflow.get("target_url", "")),
            nodes=sorted(nodes, key=lambda item: (item.order_index, item.id)),
            fields=fields,
            edges=edges,
            expected_outcome=str(scenario.get("expected_outcome") or "success"),
            case_definition=(
                scenario.get("case_definition")
                if isinstance(scenario.get("case_definition"), dict)
                else {}
            ),
        )


@dataclass(frozen=True)
class ExecutionRecord:
    id: str
    workflow_id: str
    scenario_version_id: str
    execution_mode: str
    start_node_id: str | None
    environment: str


@dataclass
class StepOutcome:
    status: str = "passed"
    output: dict[str, Any] = field(default_factory=dict)
    assertions: list[dict[str, Any]] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    artifact: tuple[str, bytes, str] | None = None
    # CAPTCHA fields
    captcha_detected: bool = False
    captcha_type: str | None = None
    captcha_solved: bool = False
    captcha_solve_duration_ms: int | None = None
    captcha_solve_cost: float | None = None


@dataclass
class ExecutionOutcome:
    status: str
    final_url: str | None
    duration_ms: int
    failure_reason: str | None
    assertions: list[dict[str, Any]]
    network_summary: dict[str, Any]
    summary: dict[str, Any]
