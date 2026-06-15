from business_verdict import (
    build_business_summary,
    business_verdict,
    compare_to_baseline,
    expected_behavior,
)


def test_expected_behavior_maps_legacy_outcomes():
    assert expected_behavior("success", {}) == "accept"
    assert expected_behavior("validation_error", {}) == "reject"
    assert expected_behavior("business_rejection", {}) == "reject"
    assert expected_behavior("server_error", {}) == "explore"


def test_reject_observed_is_conform():
    assert (
        business_verdict(expected="reject", observed="validation_rejected")
        == "conform"
    )


def test_reject_accepted_is_unexpected_acceptance():
    assert (
        business_verdict(expected="reject", observed="accepted")
        == "unexpected_acceptance"
    )


def test_accept_rejected_is_unexpected_rejection():
    assert (
        business_verdict(expected="accept", observed="business_rejected")
        == "unexpected_rejection"
    )


def test_exploratory_never_creates_anomaly():
    assert (
        business_verdict(
            expected="explore",
            observed="accepted",
            evaluation_mode="exploratory",
        )
        == "observation"
    )


def test_inconclusive_baseline_does_not_contaminate_reject_case():
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="validation_error",
        case_definition={"expected_behavior": "reject"},
        submission={"invalid_control_count": 1},
        oracle={"verdict": "observed"},
        campaign_context={
            "campaign_role": "case",
            "evaluation_mode": "explicit_oracle",
            "baseline_summary": {"business_verdict": "needs_confirmation"},
        },
    )
    assert summary["business_verdict"] == "conform"


def test_inconclusive_baseline_marks_accept_case_for_confirmation():
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="success",
        case_definition={"expected_behavior": "accept"},
        submission={"response_status": 204, "dom_changed": True},
        oracle={"verdict": "observed"},
        campaign_context={
            "campaign_role": "case",
            "evaluation_mode": "baseline_comparison",
            "baseline_summary": {"business_verdict": "needs_confirmation"},
        },
    )
    assert summary["business_verdict"] == "needs_confirmation"


def test_accept_case_uses_nominal_signature():
    comparison = compare_to_baseline(
        {
            "response_status": 204,
            "dom_changed": True,
            "url_changed": False,
            "form_present_after": True,
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [
                    {"concepts": ["submission_accepted"]},
                ],
            },
        },
        {
            "response_status": 204,
            "dom_changed": True,
            "url_changed": False,
            "form_present_after": True,
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [
                    {"concepts": ["submission_accepted"]},
                ],
            },
        },
    )
    assert comparison["available"] is True
    assert comparison["score"] == 1.0


def test_new_validation_wins_over_apparent_confirmation():
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="validation_error",
        case_definition={"expected_behavior": "reject"},
        submission={
            "invalid_control_count": 1,
            "validation_messages": ["Un autre champ est requis"],
            "semantic_dom": {
                "success_messages": [
                    {
                        "text": "Votre demande a bien été envoyée.",
                        "concepts": ["submission_accepted"],
                    }
                ],
                "validation_messages": [
                    {
                        "text": "Un autre champ est requis.",
                        "concepts": ["required_field"],
                    }
                ],
                "rejection_messages": [],
            },
            "response_status": 200,
        },
        oracle={"verdict": "not_observed"},
        campaign_context={"evaluation_mode": "explicit_oracle"},
    )

    assert summary["observed_behavior"] == "validation_rejected"
    assert summary["business_verdict"] == "conform"


def test_targeted_validation_not_observed_is_not_false_conform():
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="validation_error",
        case_definition={"expected_behavior": "reject"},
        submission={"invalid_control_count": 0},
        oracle={"verdict": "not_observed"},
        campaign_context={"evaluation_mode": "explicit_oracle"},
    )

    assert summary["observed_behavior"] == "inconclusive"
    assert summary["business_verdict"] == "needs_confirmation"


def test_application_validation_message_without_native_invalid_is_rejection():
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="validation_error",
        case_definition={"expected_behavior": "reject"},
        submission={
            "invalid_control_count": 0,
            "semantic_dom": {
                "success_messages": [],
                "validation_messages": [
                    {"text": "Ce champ est obligatoire.", "concepts": ["obligatoire"]}
                ],
                "rejection_messages": [],
                "form_lifecycle": "retained",
            },
        },
        oracle={"verdict": "not_observed"},
        campaign_context={"evaluation_mode": "explicit_oracle"},
    )

    assert summary["observed_behavior"] == "validation_rejected"
    assert summary["business_verdict"] == "conform"


def test_reject_case_matching_conclusive_nominal_is_unexpected_acceptance():
    nominal_signature = {
        "response_status": 200,
        "response_method": "POST",
        "response_url_pattern": "https://example.com/contact",
        "final_url_pattern": "https://example.com/contact",
        "form_lifecycle": "replaced",
        "success_concepts": ["merci"],
        "validation_concepts": [],
        "rejection_concepts": [],
        "invalid_control_count": 0,
        "dom_changed": True,
        "url_changed": False,
    }
    summary = build_business_summary(
        execution_status="passed",
        expected_outcome="validation_error",
        case_definition={"expected_behavior": "reject"},
        submission={
            "submission_response": {
                "status": 200,
                "method": "POST",
                "url": "https://example.com/contact",
            },
            "final_url": "https://example.com/contact",
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [],
                "validation_messages": [],
                "rejection_messages": [],
            },
            "dom_changed": True,
        },
        oracle={"verdict": "not_observed"},
        campaign_context={
            "campaign_role": "case",
            "evaluation_mode": "explicit_oracle",
            "reference_conclusive": True,
            "baseline_summary": {
                "business_verdict": "conform",
                "observed_behavior": "accepted",
                "baseline_signature": nominal_signature,
            },
        },
    )

    assert summary["observed_behavior"] == "accepted"
    assert summary["business_verdict"] == "unexpected_acceptance"
