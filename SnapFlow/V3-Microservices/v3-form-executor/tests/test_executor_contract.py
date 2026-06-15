from __future__ import annotations

from dataclasses import replace

import pytest

from executor import GraphValidationError, build_execution_plan, validate_graph
from models import EdgeDefinition, FieldDefinition, ScenarioSnapshot, normalize_field_type
from nodes.common import safe_fixture_path
from nodes.upload import _prepare_generated_fixture
from redaction import redact
from storage import control_command_execution_mode
from tests.helpers import field, node, snapshot


def test_field_values_are_not_trimmed():
    item = field(
        "password",
        "password",
        "password",
        "input[name='password']",
        " phase3 secret ",
        sensitive=True,
    )
    assert item.value == " phase3 secret "


def test_legacy_field_types_are_normalized_in_snapshots():
    assert normalize_field_type("true") == "text"
    assert normalize_field_type("input") == "text"
    assert normalize_field_type("radio") == "radio"
    assert normalize_field_type("checkbox") == "checkbox"


def test_graph_rejects_cycles_and_invalid_condition_targets():
    cycle = ScenarioSnapshot(
        target_url="https://example.test",
        nodes=[node("a", "trigger", 0), node("b", "assert", 1, value="ok")],
        fields=[],
        edges=[
            EdgeDefinition("a", "b"),
            EdgeDefinition("b", "a"),
        ],
    )
    with pytest.raises(GraphValidationError, match="cycle"):
        validate_graph(cycle)

    invalid_branch = snapshot(
        "https://example.test",
        [
            node("trigger", "trigger", 0),
            node("condition", "condition", 1, true_node_id="missing"),
        ],
    )
    with pytest.raises(GraphValidationError, match="condition_target_unknown"):
        validate_graph(invalid_branch)


def test_execution_plans_replay_prerequisites_without_recording_them():
    scenario = snapshot(
        "https://example.test",
        [
            node("trigger", "trigger", 0),
            node("fill", "form_fill", 1),
            node("submit", "submit", 2),
            node("assert", "assert", 3, value="ok"),
        ],
        [field("fill", "name", "text", "input[name='name']", "Alice")],
    )

    step_plan = build_execution_plan(scenario, "step", "submit")
    assert [(item.id, recorded) for item, recorded in step_plan] == [
        ("trigger", False),
        ("fill", False),
        ("submit", True),
    ]

    from_plan = build_execution_plan(scenario, "from_step", "submit")
    assert [(item.id, recorded) for item, recorded in from_plan] == [
        ("trigger", False),
        ("fill", False),
        ("submit", True),
        ("assert", True),
    ]


def test_redaction_masks_keys_inline_values_and_known_field_values():
    secret = " phase3 secret "
    payload = {
        "password": secret,
        "message": f"authorization=abc and submitted {secret}",
        "nested": [{"cookie": "session-value"}],
    }
    result = redact(payload, {secret})

    assert result["password"] == "[REDACTED]"
    assert secret not in result["message"]
    assert "abc" not in result["message"]
    assert result["nested"][0]["cookie"] == "[REDACTED]"


def test_upload_fixture_cannot_escape_allowed_directory(tmp_path):
    fixture_root = tmp_path / "uploads"
    fixture_root.mkdir()
    allowed = fixture_root / "sample.txt"
    allowed.write_text("ok", encoding="utf-8")
    outside = tmp_path / "outside.txt"
    outside.write_text("no", encoding="utf-8")

    assert safe_fixture_path("sample.txt", str(fixture_root)) == str(allowed.resolve())
    with pytest.raises(ValueError, match="outside_allowed_directory"):
        safe_fixture_path(str(outside), str(fixture_root))


def test_generated_upload_fixtures_are_bounded_and_local(tmp_path):
    fixture_root = tmp_path / "uploads"
    _prepare_generated_fixture("snapflow-empty.txt", str(fixture_root))
    _prepare_generated_fixture("snapflow-6mb.bin", str(fixture_root))

    assert (fixture_root / "snapflow-empty.txt").stat().st_size == 0
    assert (fixture_root / "snapflow-6mb.bin").stat().st_size == 6 * 1024 * 1024


def test_control_commands_create_the_expected_execution_mode():
    assert control_command_execution_mode("retry") == "full"
    assert control_command_execution_mode("run_step") == "step"
    assert control_command_execution_mode("run_from") == "from_step"
    with pytest.raises(ValueError, match="unsupported_control_command"):
        control_command_execution_mode("delete")
