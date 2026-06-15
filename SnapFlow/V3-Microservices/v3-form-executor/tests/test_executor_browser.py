from __future__ import annotations

import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from playwright.async_api import async_playwright

from challenge_resolver import SolveResult
from executor import FormExecutor
from models import EdgeDefinition, ScenarioSnapshot
from tests.helpers import MemoryStorage, execution, field, node, settings, snapshot


async def run_scenario(tmp_path, scenario, *, stop=False, mode="full", start_node_id=None):
    storage = MemoryStorage(scenario, stop=stop)
    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.launch(headless=True)
        except Exception as exc:
            pytest.skip(f"Playwright Chromium is not installed: {exc}")
        try:
            executor = FormExecutor(settings(tmp_path), storage, browser)
            outcome = await executor.execute(
                execution(mode=mode, start_node_id=start_node_id)
            )
            return outcome, storage
        finally:
            await browser.close()


def contact_scenario(base_url):
    return snapshot(
        f"{base_url}/contact.html",
        [
            node("trigger", "trigger", 0),
            node("name", "form_fill", 1),
            node("email", "form_fill", 2),
            node("message", "form_fill", 3),
            node("consent", "form_fill", 4),
            node("submit", "submit", 5, selector="#contact-form button[type='submit']"),
            node("assert", "assert", 6, type="text_present", value="Contact request received"),
        ],
        [
            field("name", "name", "text", "input[name='name']", "Alice"),
            field("email", "email", "email", "input[name='email']", "alice@example.test", sensitive=True),
            field("message", "message", "textarea", "textarea[name='message']", "Hello Phase 3"),
            field("consent", "consent", "checkbox", "input[name='consent']", "true"),
        ],
    )


def login_scenario(base_url):
    return snapshot(
        f"{base_url}/login.html",
        [
            node("trigger", "trigger", 0),
            node("username", "form_fill", 1),
            node("password", "form_fill", 2),
            node("submit", "submit", 3, selector="#login-form button[type='submit']"),
            node("assert", "assert", 4, type="text_present", value="Signed in"),
        ],
        [
            field("username", "username", "text", "input[name='username']", "tester"),
            field(
                "password",
                "password",
                "password",
                "input[name='password']",
                " phase3 secret ",
                sensitive=True,
            ),
        ],
    )


def upload_scenario(base_url):
    return snapshot(
        f"{base_url}/upload.html",
        [
            node("trigger", "trigger", 0),
            node("document", "form_fill", 1),
            node("submit", "submit", 2, selector="#upload-form button[type='submit']"),
            node("assert", "assert", 3, type="text_present", value="Uploaded sample.txt"),
        ],
        [
            field(
                "document",
                "document",
                "file",
                "input[name='document']",
                "sample.txt",
            )
        ],
    )


def httpbin_like_legacy_scenario(base_url):
    return snapshot(
        f"{base_url}/httpbin-like.html",
        [
            node("trigger", "trigger", 0),
            node("name", "form_fill", 1),
            node("phone", "form_fill", 2),
            node("email", "form_fill", 3),
            node("size-small", "form_fill", 4),
            node("size-medium", "form_fill", 5),
            node("topping-bacon", "form_fill", 6),
            node("topping-cheese", "form_fill", 7),
            node("delivery", "form_fill", 8),
            node("comments", "form_fill", 9),
            node("submit", "submit", 10, selector="#pizza-form button[type='submit']"),
            node("assert", "assert", 11, type="text_present", value="Order received for Mohamed"),
        ],
        [
            field("name", "custname", "input", "input[name='custname']", "Mohamed"),
            field("phone", "custtel", "true", "input[name='custtel']", "12345678"),
            field("email", "custemail", "true", "input[name='custemail']", "test@example.com", sensitive=True),
            field("size-small", "size", "true", 'input[name="size"][value="small"]', "true"),
            field("size-medium", "size", "true", 'input[name="size"][value="medium"]', "false", required=False),
            field("topping-bacon", "topping", "true", 'input[name="topping"][value="bacon"]', "true"),
            field("topping-cheese", "topping", "true", 'input[name="topping"][value="cheese"]', "true"),
            field("delivery", "delivery", "time", "input[name='delivery']", "Valeur de test Snapflow"),
            field("comments", "comments", "textarea", "textarea[name='comments']", "Legacy metadata should still work"),
        ],
    )


def v2_oracle_scenario(
    base_scenario,
    *,
    expected_outcome,
    signals,
):
    source_nodes = [item for item in base_scenario.nodes if item.type != "assert"]
    submit_node = next(item for item in source_nodes if item.type == "submit")
    oracle = {
        "expected_outcome": expected_outcome,
        "pass_threshold": 0.65,
        "inconclusive_threshold": 0.4,
        "signals": signals,
    }
    nodes = [
        *source_nodes,
        node("inspect", "inspect_response", submit_node.order_index + 1),
        node(
            "outcome-condition",
            "condition",
            submit_node.order_index + 2,
            type="submission_outcome",
            expected_outcome=expected_outcome,
            oracle=oracle,
        ),
        node(
            "outcome-success",
            "assert",
            submit_node.order_index + 3,
            type="submission_outcome",
            expected_outcome=expected_outcome,
            oracle=oracle,
        ),
        node("outcome-capture", "screenshot", submit_node.order_index + 3),
        node(
            "outcome-failure",
            "assert",
            submit_node.order_index + 4,
            type="submission_outcome",
            expected_outcome=expected_outcome,
            oracle=oracle,
        ),
    ]
    linear_nodes = sorted(source_nodes, key=lambda item: item.order_index)
    edges = [
        EdgeDefinition(source.id, target.id)
        for source, target in zip(linear_nodes, linear_nodes[1:])
    ]
    edges.extend(
        [
            EdgeDefinition(submit_node.id, "inspect", "success"),
            EdgeDefinition("inspect", "outcome-condition"),
            EdgeDefinition("outcome-condition", "outcome-success", "true"),
            EdgeDefinition("outcome-condition", "outcome-capture", "false"),
            EdgeDefinition("outcome-capture", "outcome-failure"),
        ]
    )
    return ScenarioSnapshot(
        target_url=base_scenario.target_url,
        nodes=nodes,
        fields=base_scenario.fields,
        edges=edges,
        expected_outcome=expected_outcome,
        case_definition={
            "plan_version": 2,
            "oracle": oracle,
            "expected_signals": signals,
        },
    )


def test_contact_login_and_upload_execute_in_real_chromium(tmp_path, fixture_server):
    async def verify():
        for scenario in (
            contact_scenario(fixture_server),
            login_scenario(fixture_server),
            upload_scenario(fixture_server),
        ):
            outcome, storage = await run_scenario(tmp_path, scenario)
            assert outcome.status == "passed", outcome
            assert outcome.summary["engine"] == "chromium"
            assert outcome.summary["recorded_steps"] == len(scenario.nodes)
            assert any(step["step_type"] == "submit" for step in storage.steps)
            assert any(item["artifact_type"] == "screenshot" for item in storage.artifacts)

    asyncio.run(verify())


def test_historical_technical_fields_are_skipped_and_stale_selectors_recover(tmp_path, fixture_server):
    async def verify():
        scenario = snapshot(
            f"{fixture_server}/contact.html",
            [
                node("trigger", "trigger", 0),
                node("captcha-sid", "form_fill", 1),
                node("name", "form_fill", 2),
                node("email", "form_fill", 3),
                node("message", "form_fill", 4),
                node("consent", "form_fill", 5),
                node("submit", "submit", 6, selector="#contact-form button[type='submit']"),
                node("assert", "assert", 7, type="text_present", value="Contact request received"),
            ],
            [
                field(
                    "captcha-sid",
                    "captcha_sid",
                    "text",
                    'input[name="captcha_sid"][value="12053"]',
                    "12053",
                    required=False,
                ),
                field("name", "name", "text", 'input[name="name"][value="old-value"]', "Alice"),
                field("email", "email", "email", "input[name='email']", "alice@example.test", sensitive=True),
                field("message", "message", "textarea", "textarea[name='message']", "Recovered workflow"),
                field("consent", "consent", "checkbox", "input[name='consent']", "true"),
            ],
        )

        outcome, storage = await run_scenario(tmp_path, scenario)

        assert outcome.status == "passed", (outcome, storage.steps)
        technical_step = next(item for item in storage.steps if item["node_id"] == "captcha-sid")
        assert technical_step["status"] == "skipped"
        assert technical_step["output"]["skip_reason"] == "browser_managed_field"
        assert technical_step["output"]["resolved_selector"] is None
        recovered_step = next(item for item in storage.steps if item["node_id"] == "name")
        assert recovered_step["status"] == "passed"
        assert recovered_step["output"]["selector_recovered"] is True
        assert recovered_step["output"]["resolved_selector"] == 'input[name="name"]'

    asyncio.run(verify())


def test_missing_business_field_still_fails(tmp_path, fixture_server):
    async def verify():
        scenario = snapshot(
            f"{fixture_server}/contact.html",
            [node("trigger", "trigger", 0), node("company", "form_fill", 1)],
            [field("company", "company", "text", 'input[name="company"]', "SnapFlow")],
        )

        outcome, storage = await run_scenario(tmp_path, scenario)

        assert outcome.status == "error"
        assert outcome.failure_reason == "selector_not_found"
        assert storage.steps[-1]["error_code"] == "selector_not_found"

    asyncio.run(verify())


def test_v2_oracle_selects_success_and_business_rejection_branches(tmp_path, fixture_server):
    async def verify():
        success = v2_oracle_scenario(
            contact_scenario(fixture_server),
            expected_outcome="success",
            signals=[
                {"type": "text_present", "value": "Contact request received", "weight": 0.8},
                {"type": "dom_changed", "weight": 0.2},
            ],
        )
        success_outcome, success_storage = await run_scenario(tmp_path, success)
        assert success_outcome.status == "passed", (success_outcome, success_storage.steps)
        assert [item["node_id"] for item in success_storage.steps][-2:] == [
            "outcome-condition",
            "outcome-success",
        ]

        rejected_login = replace(
            login_scenario(fixture_server),
            fields=[
                field("username", "username", "text", "input[name='username']", "unknown-user"),
                field(
                    "password",
                    "password",
                    "password",
                    "input[name='password']",
                    "invalid-password",
                    sensitive=True,
                ),
            ],
        )
        rejection = v2_oracle_scenario(
            rejected_login,
            expected_outcome="business_rejection",
            signals=[
                {"type": "text_present", "value": "Invalid credentials", "weight": 0.8},
                {"type": "dom_changed", "weight": 0.2},
            ],
        )
        rejection_outcome, rejection_storage = await run_scenario(tmp_path, rejection)
        assert rejection_outcome.status == "passed", (rejection_outcome, rejection_storage.steps)
        condition = next(
            item for item in rejection_storage.steps if item["node_id"] == "outcome-condition"
        )
        assert condition["output"]["selected_branch"] == "true"
        assert condition["output"]["oracle"]["score"] == pytest.approx(1.0)

    asyncio.run(verify())


def test_v2_oracle_marks_weak_evidence_inconclusive(tmp_path, fixture_server):
    async def verify():
        scenario = v2_oracle_scenario(
            contact_scenario(fixture_server),
            expected_outcome="success",
            signals=[
                {"type": "response_status_range", "value": "500-599", "weight": 0.5},
                {"type": "dom_changed", "weight": 0.5},
            ],
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "inconclusive", (outcome, storage.steps)
        assert outcome.failure_reason == "submission_outcome_inconclusive"
        assert [item["node_id"] for item in storage.steps][-2:] == [
            "outcome-capture",
            "outcome-failure",
        ]
        assert storage.steps[-1]["status"] == "inconclusive"

    asyncio.run(verify())


def test_legacy_true_field_types_use_real_dom_handlers(tmp_path, fixture_server):
    async def verify():
        outcome, storage = await run_scenario(tmp_path, httpbin_like_legacy_scenario(fixture_server))
        assert outcome.status == "passed", (outcome, storage.steps)

        step_types_by_node = {step["node_id"]: step["step_type"] for step in storage.steps}
        assert step_types_by_node["size-small"] == "check"
        assert step_types_by_node["size-medium"] == "check"
        assert step_types_by_node["topping-bacon"] == "check"
        assert step_types_by_node["topping-cheese"] == "check"
        assert step_types_by_node["phone"] == "fill"
        delivery_step = next(step for step in storage.steps if step["node_id"] == "delivery")
        assert delivery_step["status"] == "passed"
        assert delivery_step["output"]["value_coerced"] is True

    asyncio.run(verify())


def test_captcha_and_otp_are_blocked_without_bypass(tmp_path, fixture_server, monkeypatch):
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "")

    async def verify():
        for fixture, reason in (
            (
                "captcha.html",
                "captcha_unsolvable:generic_captcha:no_captcha_api_key_configured",
            ),
            ("otp.html", "otp_required"),
        ):
            scenario = snapshot(
                f"{fixture_server}/{fixture}",
                [node("trigger", "trigger", 0)],
            )
            outcome, storage = await run_scenario(tmp_path, scenario)
            assert outcome.status == "blocked"
            assert outcome.failure_reason == reason
            assert storage.steps[0]["status"] == "blocked"
            assert {item["artifact_type"] for item in storage.artifacts} >= {
                "screenshot",
                "html_snapshot",
            }

    asyncio.run(verify())


def test_executor_resolves_each_captcha_once(tmp_path, fixture_server, monkeypatch):
    async def verify():
        resolve = AsyncMock(
            return_value=SolveResult(
                success=True,
                task_id="12345",
                task_type="RecaptchaV2TaskProxyless",
                solve_duration_ms=1250,
                cost=0.00299,
            )
        )
        monkeypatch.setattr("executor.resolve_captcha", resolve)
        scenario = snapshot(
            f"{fixture_server}/recaptcha-v2.html",
            [node("trigger", "trigger", 0)],
        )

        outcome, storage = await run_scenario(tmp_path, scenario)

        assert outcome.status == "passed", (outcome, storage.steps)
        assert resolve.await_count == 1
        assert storage.steps[0]["captcha_detected"] is True
        assert storage.steps[0]["captcha_type"] == "recaptcha_v2"
        assert storage.steps[0]["captcha_solved"] is True
        assert storage.steps[0]["output"]["captcha_task_type"] == "RecaptchaV2TaskProxyless"

    asyncio.run(verify())


def test_expected_captcha_block_is_a_successful_test_case(tmp_path, fixture_server):
    async def verify():
        scenario = ScenarioSnapshot(
            target_url=f"{fixture_server}/captcha.html",
            nodes=[
                node("trigger", "trigger", 0),
                node("never", "assert", 1, type="text_present", value="Never reached"),
            ],
            fields=[],
            edges=[EdgeDefinition("trigger", "never")],
            expected_outcome="blocked",
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "passed", (outcome, storage.steps)
        assert [item["node_id"] for item in storage.steps] == ["trigger"]
        assert storage.steps[0]["output"]["expected_block_observed"] is True
        assert "never" in outcome.summary["skipped_node_ids"]

    asyncio.run(verify())


def test_inert_submit_fails_with_step_error_and_evidence(tmp_path, fixture_server):
    async def verify():
        scenario = snapshot(
            f"{fixture_server}/no-effect.html",
            [
                node("trigger", "trigger", 0),
                node("submit", "submit", 1, selector="#inert-submit"),
            ],
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "failed"
        assert outcome.failure_reason == "submit_no_observable_effect"
        failed_step = storage.steps[-1]
        assert failed_step["status"] == "failed"
        assert failed_step["error_code"] == "submit_no_observable_effect"
        assert {item["artifact_type"] for item in storage.artifacts} >= {
            "screenshot",
            "html_snapshot",
        }

    asyncio.run(verify())


def test_stop_and_partial_execution_modes_are_truthful(tmp_path, fixture_server):
    async def verify():
        scenario = contact_scenario(fixture_server)
        stopped, stopped_storage = await run_scenario(tmp_path, scenario, stop=True)
        assert stopped.status == "cancelled"
        assert stopped.failure_reason == "stopped_by_user"
        assert stopped.summary["executed_steps"] == 0
        assert stopped_storage.steps == []

        single_step, step_storage = await run_scenario(
            tmp_path,
            scenario,
            mode="step",
            start_node_id="submit",
        )
        assert single_step.status == "passed"
        assert [item["node_id"] for item in step_storage.steps] == ["submit"]
        assert single_step.summary["recorded_steps"] == 1
        assert single_step.summary["executed_steps"] == 6

        from_step, from_storage = await run_scenario(
            tmp_path,
            scenario,
            mode="from_step",
            start_node_id="submit",
        )
        assert from_step.status == "passed"
        assert [item["node_id"] for item in from_storage.steps] == ["submit", "assert"]

    asyncio.run(verify())


def test_condition_selects_the_configured_forward_branch(tmp_path, fixture_server):
    async def verify():
        scenario = snapshot(
            f"{fixture_server}/condition.html",
            [
                node("trigger", "trigger", 0),
                node(
                    "condition",
                    "condition",
                    1,
                    type="text_present",
                    value="Premium workflow enabled",
                    true_node_id="premium-assert",
                    false_node_id="wrong-assert",
                ),
                node("wrong-assert", "assert", 2, type="text_present", value="Never present"),
                node("premium-assert", "assert", 3, type="text_present", value="Premium workflow enabled"),
            ],
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "passed"
        assert [item["node_id"] for item in storage.steps] == [
            "trigger",
            "condition",
            "premium-assert",
        ]
        condition_step = next(item for item in storage.steps if item["node_id"] == "condition")
        assert condition_step["output"]["selected_branch"] == "true"

    asyncio.run(verify())


def test_typed_false_branch_does_not_execute_the_true_path(tmp_path, fixture_server):
    async def verify():
        scenario = ScenarioSnapshot(
            target_url=f"{fixture_server}/condition.html",
            nodes=[
                node("trigger", "trigger", 0),
                node("condition", "condition", 1, type="text_present", value="Not on this page"),
                node("wrong-assert", "assert", 2, type="text_present", value="Never present"),
                node("expected-assert", "assert", 3, type="text_present", value="Premium workflow enabled"),
            ],
            fields=[],
            edges=[
                EdgeDefinition("trigger", "condition"),
                EdgeDefinition("condition", "wrong-assert", "true"),
                EdgeDefinition("condition", "expected-assert", "false"),
            ],
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "passed"
        assert [item["node_id"] for item in storage.steps] == [
            "trigger",
            "condition",
            "expected-assert",
        ]
        assert "wrong-assert" in outcome.summary["skipped_node_ids"]

    asyncio.run(verify())


def test_expected_validation_error_is_a_successful_test_case(tmp_path, fixture_server):
    async def verify():
        scenario = ScenarioSnapshot(
            target_url=f"{fixture_server}/contact.html",
            nodes=[
                node("trigger", "trigger", 0),
                node("name", "form_fill", 1),
                node("email", "form_fill", 2),
                node("submit", "submit", 3, selector="#contact-form button[type='submit']"),
                node("success-assert", "assert", 4, type="text_present", value="Contact request received"),
            ],
            fields=[
                field("name", "name", "text", "input[name='name']", ""),
                field("email", "email", "email", "input[name='email']", "invalid-email"),
            ],
            edges=[
                EdgeDefinition("trigger", "name"),
                EdgeDefinition("name", "email"),
                EdgeDefinition("email", "submit"),
                EdgeDefinition("submit", "success-assert"),
            ],
            expected_outcome="validation_error",
            case_definition={
                "expected_signals": [{"type": "form_invalid"}],
            },
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "passed"
        submit_step = next(item for item in storage.steps if item["node_id"] == "submit")
        assert submit_step["output"]["form_invalid"] is True
        assert submit_step["assertions"][0]["passed"] is True
        assert "success-assert" in outcome.summary["skipped_node_ids"]

    asyncio.run(verify())


def test_validation_case_fails_when_invalid_data_is_accepted(tmp_path, fixture_server):
    async def verify():
        scenario = replace(
            contact_scenario(fixture_server),
            expected_outcome="validation_error",
            case_definition={"expected_signals": [{"type": "form_invalid"}]},
        )
        outcome, storage = await run_scenario(tmp_path, scenario)
        assert outcome.status == "failed"
        assert outcome.failure_reason == "expected_validation_error_not_observed"
        assert [item["node_id"] for item in storage.steps][-1] == "submit"
        assert storage.steps[-1]["assertions"][0]["passed"] is False

    asyncio.run(verify())
