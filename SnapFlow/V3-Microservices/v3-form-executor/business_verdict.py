from __future__ import annotations

from typing import Any

from semantic_observation import (
    compare_semantic_signatures,
    reference_quality,
)


TERMINAL_TECHNICAL_STATUSES = {"error", "blocked", "cancelled"}


def expected_behavior(expected_outcome: str, case_definition: dict[str, Any]) -> str:
    configured = str(case_definition.get("expected_behavior") or "").strip().lower()
    if configured in {"accept", "reject", "explore"}:
        return configured
    if expected_outcome == "success":
        return "accept"
    if expected_outcome in {"validation_error", "business_rejection"}:
        return "reject"
    return "explore"


def observed_behavior(
    *,
    execution_status: str,
    expected_outcome: str,
    submission: dict[str, Any],
    oracle: dict[str, Any] | None,
) -> str:
    if execution_status in TERMINAL_TECHNICAL_STATUSES:
        return "technical_error"
    if execution_status in {"inconclusive", "needs_review"}:
        return "inconclusive"

    oracle_verdict = str((oracle or {}).get("verdict") or "")
    invalid_count = int(submission.get("invalid_control_count") or 0)
    validation_messages = submission.get("validation_messages") or []
    semantic = (
        submission.get("semantic_dom")
        if isinstance(submission.get("semantic_dom"), dict)
        else {}
    )
    semantic_success = semantic.get("success_messages") or []
    semantic_validation = semantic.get("validation_messages") or []
    semantic_rejection = semantic.get("rejection_messages") or []
    semantic_technical = semantic.get("technical_error_messages") or []

    if semantic_technical:
        return "technical_error"
    if semantic_validation or invalid_count > 0 or validation_messages:
        return "validation_rejected"
    if semantic_rejection:
        return "business_rejected"
    if semantic_success:
        return "accepted"

    if expected_outcome == "business_rejection" and oracle_verdict == "observed":
        return "business_rejected"
    if expected_outcome == "validation_error":
        if oracle_verdict == "observed":
            return "validation_rejected"
        if oracle_verdict == "not_observed":
            return "inconclusive"
        if oracle_verdict == "inconclusive":
            return "inconclusive"

    if execution_status in {"passed", "pass"}:
        return "accepted" if oracle_verdict == "observed" else "inconclusive"
    if expected_outcome == "success" and execution_status in {"failed", "fail"}:
        if invalid_count > 0:
            return "validation_rejected"
        return "business_rejected" if semantic_rejection else "inconclusive"
    return "inconclusive"


def business_verdict(
    *,
    expected: str,
    observed: str,
    baseline_conclusive: bool = True,
    evaluation_mode: str | None = None,
) -> str:
    if observed == "technical_error":
        return "interrupted"
    if expected == "explore" or evaluation_mode == "exploratory":
        return "observation"
    if observed == "inconclusive":
        return "needs_confirmation"
    if expected == "accept" and evaluation_mode == "baseline_comparison" and not baseline_conclusive:
        return "needs_confirmation"
    if expected == "accept":
        return "conform" if observed == "accepted" else "unexpected_rejection"
    if expected == "reject":
        return (
            "conform"
            if observed in {"validation_rejected", "business_rejected"}
            else "unexpected_acceptance"
        )
    return "needs_confirmation"


def suggested_severity(
    *,
    verdict: str,
    form_type: str | None,
    target_field_name: str | None,
) -> tuple[str | None, str | None]:
    if verdict not in {"unexpected_acceptance", "unexpected_rejection"}:
        return None, None
    searchable = f"{form_type or ''} {target_field_name or ''}".casefold()
    if any(token in searchable for token in ("payment", "paiement", "password", "mot de passe", "consent")):
        return "high", "Le scenario touche une operation sensible ou une obligation de consentement."
    if any(token in searchable for token in ("email", "telephone", "tel", "login", "connexion")):
        return "medium", "Le comportement peut degrader la qualite des donnees ou l acces utilisateur."
    return "low", "Le comportement differe de l attente fonctionnelle configuree."


def compare_to_baseline(
    submission: dict[str, Any],
    baseline_signature: dict[str, Any] | None,
) -> dict[str, Any]:
    result = compare_semantic_signatures(submission, baseline_signature)
    return {
        **result,
        "score": result.get("similarity_score", 0.0),
        "evidence": [
            {"label": label, "matched": True}
            for label in result.get("matched_signals") or []
        ]
        + [
            {"label": label, "matched": False}
            for label in result.get("conflicting_signals") or []
        ],
    }


def build_business_summary(
    *,
    execution_status: str,
    expected_outcome: str,
    case_definition: dict[str, Any],
    submission: dict[str, Any],
    oracle: dict[str, Any] | None,
    campaign_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = campaign_context or {}
    expected = expected_behavior(expected_outcome, case_definition)
    observed = observed_behavior(
        execution_status=execution_status,
        expected_outcome=expected_outcome,
        submission=submission,
        oracle=oracle,
    )
    baseline_summary = context.get("baseline_summary")
    baseline_verdict = (
        str(baseline_summary.get("business_verdict") or "")
        if isinstance(baseline_summary, dict)
        else ""
    )
    is_baseline = context.get("campaign_role") == "baseline"
    baseline_observed = (
        str(baseline_summary.get("observed_behavior") or "")
        if isinstance(baseline_summary, dict)
        else ""
    )
    configured_reference_conclusive = context.get("reference_conclusive")
    baseline_conclusive = is_baseline or (
        bool(configured_reference_conclusive)
        if configured_reference_conclusive is not None
        else baseline_verdict == "conform" and baseline_observed == "accepted"
    )
    comparison = compare_to_baseline(
        submission,
        baseline_summary.get("baseline_signature")
        if isinstance(baseline_summary, dict)
        and isinstance(baseline_summary.get("baseline_signature"), dict)
        else None,
    )
    if (
        expected in {"accept", "reject"}
        and baseline_conclusive
        and comparison["available"]
        and observed == "inconclusive"
        and comparison["score"] >= 0.7
    ):
        observed = "accepted"
    verdict = business_verdict(
        expected=expected,
        observed=observed,
        baseline_conclusive=baseline_conclusive,
        evaluation_mode=str(context.get("evaluation_mode") or ""),
    )
    severity, severity_reason = suggested_severity(
        verdict=verdict,
        form_type=str(case_definition.get("form_type") or "") or None,
        target_field_name=str(
            case_definition.get("target_field_name")
            or case_definition.get("target_field_id")
            or ""
        )
        or None,
    )
    return {
        "expected_behavior": expected,
        "observed_behavior": observed,
        "business_verdict": verdict,
        "effective_business_verdict": verdict,
        "suggested_severity": severity,
        "suggested_severity_reason": severity_reason,
        "baseline_conclusive": baseline_conclusive,
        "baseline_comparison": comparison,
        "reference_quality": reference_quality(
            execution_status=execution_status,
            submission=submission,
            oracle=oracle,
        ),
    }
