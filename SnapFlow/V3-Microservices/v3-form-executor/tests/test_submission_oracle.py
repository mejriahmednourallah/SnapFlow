from __future__ import annotations

from types import SimpleNamespace

import pytest

from nodes.submit import (
    _added_text_snippets,
    _message_candidate_diff,
    _repair_text,
    _submission_response,
)
from oracle import evaluate_submission_oracle


class FakePage:
    url = "https://example.com/contact"


@pytest.mark.asyncio
async def test_same_page_confirmation_message_can_confirm_success():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(case_definition={}, expected_outcome="success", fields=[]),
        last_submission={
            "response_status": 200,
            "dom_changed": True,
            "url_changed": False,
            "form_present_after": True,
            "after_text": "Votre demande a bien ete envoyee. Merci.",
            "added_text_snippets": ["Votre demande a bien ete envoyee. Merci."],
            "semantic_dom": {
                "success_messages": [
                    {
                        "text": "Votre demande a bien été envoyée.",
                        "concepts": ["submission_accepted"],
                        "score": 0.95,
                    }
                ],
                "validation_messages": [],
                "rejection_messages": [],
            },
        },
    )

    result = await evaluate_submission_oracle(FakePage(), context, {})

    assert result["verdict"] == "observed"
    assert result["score"] >= result["pass_threshold"]
    assert any(
        item["type"] == "success_message_present" and item["matched"]
        for item in result["evidence"]
    )


@pytest.mark.asyncio
async def test_http_and_dom_only_remain_inconclusive():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(case_definition={}, expected_outcome="success", fields=[]),
        last_submission={
            "response_status": 200,
            "dom_changed": True,
            "url_changed": False,
            "form_present_after": True,
            "after_text": "Formulaire de contact",
            "added_text_snippets": [],
        },
    )

    result = await evaluate_submission_oracle(FakePage(), context, {})

    assert result["verdict"] == "inconclusive"


@pytest.mark.asyncio
async def test_validation_error_must_match_the_targeted_field():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(case_definition={}, expected_outcome="validation_error", fields=[]),
        last_submission={
            "invalid_control_count": 1,
            "invalid_controls": [
                {
                    "field_id": "name-field",
                    "validation_message": "Please fill out this field.",
                }
            ],
            "validation_messages": ["Please fill out this field."],
        },
    )
    config = {
        "oracle": {
            "signals": [
                {"type": "form_invalid", "field_id": "email-field", "weight": 0.55},
                {
                    "type": "validation_message_present",
                    "field_id": "email-field",
                    "weight": 0.45,
                },
            ]
        }
    }

    result = await evaluate_submission_oracle(FakePage(), context, config)

    assert result["verdict"] == "not_observed"
    assert result["score"] == 0


@pytest.mark.asyncio
async def test_validation_error_passes_when_targeted_field_is_invalid():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(case_definition={}, expected_outcome="validation_error", fields=[]),
        last_submission={
            "invalid_control_count": 1,
            "invalid_controls": [
                {
                    "field_id": "email-field",
                    "validation_message": "Please enter a valid email address.",
                }
            ],
            "validation_messages": ["Please enter a valid email address."],
        },
    )
    config = {
        "oracle": {
            "signals": [
                {"type": "form_invalid", "field_id": "email-field", "weight": 0.55},
                {
                    "type": "validation_message_present",
                    "field_id": "email-field",
                    "weight": 0.45,
                },
            ]
        }
    }

    result = await evaluate_submission_oracle(FakePage(), context, config)

    assert result["verdict"] == "observed"
    assert result["score"] == 1


@pytest.mark.asyncio
async def test_form_scoped_validation_accepts_any_blocking_field():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(case_definition={}, expected_outcome="validation_error", fields=[]),
        last_submission={
            "invalid_control_count": 1,
            "invalid_controls": [
                {
                    "field_id": "unrelated-field",
                    "validation_message": "Please fill out this field.",
                }
            ],
            "validation_messages": ["Please fill out this field."],
        },
    )
    config = {
        "oracle": {
            "signals": [
                {"type": "form_invalid", "weight": 0.55},
                {"type": "validation_message_present", "weight": 0.45},
            ]
        }
    }

    result = await evaluate_submission_oracle(FakePage(), context, config)

    assert result["verdict"] == "observed"
    assert result["score"] == 1


def test_added_text_snippets_are_bounded_and_only_include_new_content():
    snippets = _added_text_snippets(
        "Formulaire de contact\nNom\nEmail",
        "Formulaire de contact\nNom\nEmail\nVotre demande a bien ete envoyee.\nMerci.",
    )

    assert snippets == ["Votre demande a bien ete envoyee.", "Merci."]


def test_message_diff_ignores_static_consent_and_keeps_new_validation():
    rows = _message_candidate_diff(
        before_candidates=[
            {
                "text": "En validant votre demande, vous confirmez avoir pris connaissance.",
                "selector": "#legal-copy",
                "role": "",
            }
        ],
        after_candidates=[
            {
                "text": "En validant votre demande, vous confirmez avoir pris connaissance.",
                "selector": "#legal-copy",
                "role": "",
            },
            {
                "text": "L'adresse email n'est pas valide.",
                "selector": ".form-item--error-message",
                "role": "alert",
            },
        ],
        added_text_snippets=[],
    )

    assert len(rows) == 1
    assert rows[0]["text"] == "L'adresse email n'est pas valide."
    assert rows[0]["is_new"] is True


def test_mae_mojibake_confirmation_is_repaired():
    assert "Félicitations" in _repair_text(
        "FÃ©licitations, nous avons bien reÃ§u votre demande."
    )


def test_submission_response_prefers_form_post_over_analytics():
    events = [
        {
            "url": "https://www.mae.tn/fr/contact",
            "method": "POST",
            "status": 200,
            "resource_type": "document",
        },
        {
            "url": "https://www.google-analytics.com/g/collect",
            "method": "POST",
            "status": 204,
            "resource_type": "fetch",
        },
    ]

    selected = _submission_response(
        events,
        action_url="https://www.mae.tn/fr/contact",
        method="POST",
        page_url="https://www.mae.tn/fr/contact",
    )

    assert selected is not None
    assert selected["status"] == 200
    assert selected["url"] == "https://www.mae.tn/fr/contact"


@pytest.mark.asyncio
async def test_cloned_field_uuid_resolves_through_stable_target_name():
    context = SimpleNamespace(
        snapshot=SimpleNamespace(
            case_definition={
                "target_field_id": "old-field-uuid",
                "target_field_name": "Nom",
            },
            expected_outcome="validation_error",
            fields=[
                SimpleNamespace(
                    id="new-field-uuid",
                    field_name="nom",
                    field_selector="#edit-nom",
                )
            ],
        ),
        last_submission={
            "invalid_control_count": 1,
            "invalid_controls": [
                {
                    "field_id": "new-field-uuid",
                    "field_name": "nom",
                    "field_selector": "#edit-nom",
                    "validation_message": "Veuillez renseigner ce champ.",
                }
            ],
            "validation_messages": ["Veuillez renseigner ce champ."],
        },
    )
    result = await evaluate_submission_oracle(
        FakePage(),
        context,
        {
            "oracle": {
                "signals": [
                    {
                        "type": "form_invalid",
                        "field_id": "old-field-uuid",
                        "weight": 1,
                    }
                ]
            }
        },
    )

    assert result["verdict"] == "observed"
