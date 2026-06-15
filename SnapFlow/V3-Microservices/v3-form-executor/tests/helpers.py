from __future__ import annotations

from dataclasses import replace
from typing import Any

from models import (
    EdgeDefinition,
    ExecutionRecord,
    FieldDefinition,
    NodeDefinition,
    ScenarioSnapshot,
)
from settings import Settings


def settings(tmp_path) -> Settings:
    return Settings(
        database_url="postgresql://unused",
        node_timeout_ms=3_000,
        navigation_timeout_ms=5_000,
        execution_timeout_ms=15_000,
        settle_ms=50,
        artifact_dir=str(tmp_path),
    )


def execution(
    *,
    mode: str = "full",
    start_node_id: str | None = None,
    execution_id: str = "execution-1",
) -> ExecutionRecord:
    return ExecutionRecord(
        id=execution_id,
        workflow_id="workflow-1",
        scenario_version_id="version-1",
        execution_mode=mode,
        start_node_id=start_node_id,
        environment="test",
    )


def node(node_id: str, node_type: str, order: int, **config: Any) -> NodeDefinition:
    return NodeDefinition(id=node_id, type=node_type, order_index=order, config=config)


def field(
    node_id: str,
    name: str,
    field_type: str,
    selector: str,
    value: str,
    *,
    required: bool = True,
    sensitive: bool = False,
) -> FieldDefinition:
    return FieldDefinition(
        id=f"field-{node_id}",
        node_id=node_id,
        field_name=name,
        field_type=field_type,
        field_selector=selector,
        required=required,
        user_value=value,
        is_sensitive=sensitive,
    )


def snapshot(
    target_url: str,
    nodes: list[NodeDefinition],
    fields: list[FieldDefinition] | None = None,
) -> ScenarioSnapshot:
    ordered = sorted(nodes, key=lambda item: item.order_index)
    return ScenarioSnapshot(
        target_url=target_url,
        nodes=ordered,
        fields=fields or [],
        edges=[
            EdgeDefinition(source_node_id=source.id, target_node_id=target.id)
            for source, target in zip(ordered, ordered[1:])
        ],
    )


class MemoryStorage:
    def __init__(self, scenario: ScenarioSnapshot, *, stop: bool = False):
        self.scenario = scenario
        self.stop = stop
        self.steps: list[dict[str, Any]] = []
        self.logs: list[dict[str, Any]] = []
        self.artifacts: list[dict[str, Any]] = []
        self.progress: list[tuple[int, int, str | None]] = []

    def load_snapshot(self, execution_record):
        return self.scenario

    def log(
        self,
        execution_id,
        event_type,
        message,
        *,
        level="info",
        step_result_id=None,
        details=None,
        sensitive_values=None,
    ):
        self.logs.append(
            {
                "execution_id": execution_id,
                "event_type": event_type,
                "message": message,
                "level": level,
                "step_result_id": step_result_id,
                "details": details or {},
            }
        )

    def update_progress(self, execution_id, completed, total, current_node_id):
        self.progress.append((completed, total, current_node_id))

    def should_stop(self, execution_id):
        return self.stop

    def start_step(
        self,
        execution_id,
        node_id,
        sequence_number,
        step_type,
        input_data,
        sensitive_values,
    ):
        step_id = f"step-{len(self.steps) + 1}"
        self.steps.append(
            {
                "id": step_id,
                "node_id": node_id,
                "sequence_number": sequence_number,
                "step_type": step_type,
                "input": input_data,
                "status": "running",
            }
        )
        return step_id

    def finish_step(self, step_id, **result):
        stored = next(item for item in self.steps if item["id"] == step_id)
        stored.update(result)

    def save_artifact(
        self,
        execution_id,
        step_result_id,
        artifact_type,
        content,
        mime_type,
        metadata=None,
    ):
        artifact_id = f"artifact-{len(self.artifacts) + 1}"
        self.artifacts.append(
            {
                "id": artifact_id,
                "execution_id": execution_id,
                "step_result_id": step_result_id,
                "artifact_type": artifact_type,
                "content": content,
                "mime_type": mime_type,
                "metadata": metadata or {},
            }
        )
        return artifact_id
