import type {
  BusinessVerdict,
  ExpectedBehavior,
  ExpectedOutcome,
  ObservedBehavior,
  WorkflowExecutionDetail,
} from './types';

export function expectedBehaviorFromLegacy(
  outcome: ExpectedOutcome | string | null | undefined,
  configured?: unknown,
): ExpectedBehavior {
  if (configured === 'accept' || configured === 'reject' || configured === 'explore') {
    return configured;
  }
  if (outcome === 'success') return 'accept';
  if (outcome === 'validation_error' || outcome === 'business_rejection') return 'reject';
  return 'explore';
}

export function executionBusinessState(result: WorkflowExecutionDetail): {
  expected: ExpectedBehavior;
  observed: ObservedBehavior;
  verdict: BusinessVerdict;
  effectiveVerdict: BusinessVerdict;
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
  hasManualReview: boolean;
  manualReview: Record<string, unknown> | null;
} {
  const summary = result.summary ?? {};
  const definition = result.scenario?.case_definition ?? {};
  const expected = expectedBehaviorFromLegacy(
    result.scenario?.expected_outcome,
    summary.expected_behavior ?? definition.expected_behavior,
  );
  const observed = (
    ['accepted', 'validation_rejected', 'business_rejected', 'technical_error', 'inconclusive']
      .includes(String(summary.observed_behavior))
      ? summary.observed_behavior
      : result.status === 'error' || result.status === 'blocked' || result.status === 'cancelled'
        ? 'technical_error'
        : result.status === 'inconclusive' || result.status === 'needs_review'
          ? 'inconclusive'
          : result.status === 'passed' || result.status === 'pass'
            ? expected === 'reject' ? 'validation_rejected' : 'accepted'
            : expected === 'reject' ? 'accepted' : 'business_rejected'
  ) as ObservedBehavior;
  const fallbackVerdict: BusinessVerdict =
    observed === 'technical_error'
      ? 'interrupted'
      : expected === 'explore'
        ? 'observation'
        : observed === 'inconclusive'
          ? 'needs_confirmation'
          : expected === 'accept'
            ? observed === 'accepted' ? 'conform' : 'unexpected_rejection'
            : observed === 'validation_rejected' || observed === 'business_rejected'
              ? 'conform' : 'unexpected_acceptance';
  const rawVerdict = (
    typeof summary.business_verdict === 'string'
      ? summary.business_verdict
      : fallbackVerdict
  ) as BusinessVerdict;
  const verdict = observed === 'inconclusive' && rawVerdict === 'conform'
    ? 'needs_confirmation'
    : rawVerdict;
  const rawEffectiveVerdict = (
    typeof summary.effective_business_verdict === 'string'
      ? summary.effective_business_verdict
      : verdict
  ) as BusinessVerdict;
  const effectiveVerdict = observed === 'inconclusive' && rawEffectiveVerdict === 'conform'
    ? 'needs_confirmation'
    : rawEffectiveVerdict;
  const severity = ['critical', 'high', 'medium', 'low'].includes(String(summary.suggested_severity))
    ? summary.suggested_severity as 'critical' | 'high' | 'medium' | 'low'
    : null;
  const manualReview =
    summary.manual_review && typeof summary.manual_review === 'object'
      ? summary.manual_review as Record<string, unknown>
      : null;
  return {
    expected,
    observed,
    verdict,
    effectiveVerdict,
    severity,
    hasManualReview: Boolean(manualReview),
    manualReview,
  };
}

export const EXPECTED_BEHAVIOR_LABELS: Record<ExpectedBehavior, string> = {
  accept: 'Accepter',
  reject: 'Refuser',
  explore: 'Explorer',
};

export const OBSERVED_BEHAVIOR_LABELS: Record<ObservedBehavior, string> = {
  accepted: 'Formulaire accepté',
  validation_rejected: 'Validation bloquante',
  business_rejected: 'Refus métier',
  technical_error: 'Exécution interrompue',
  inconclusive: 'Comportement incertain',
};

export const BUSINESS_VERDICT_LABELS: Record<BusinessVerdict, string> = {
  conform: 'Conforme',
  unexpected_acceptance: 'Anomalie — Acceptation inattendue',
  unexpected_rejection: 'Anomalie — Rejet inattendu',
  needs_confirmation: 'À confirmer',
  interrupted: 'Test interrompu',
  observation: 'Observation',
};

export function businessConclusion(result: WorkflowExecutionDetail): string {
  const { expected, observed, effectiveVerdict, hasManualReview, manualReview } = executionBusinessState(result);
  const target =
    result.scenario?.case_definition?.target_field_name ??
    result.scenario?.case_definition?.target_field_id;
  const field = target ? ` « ${String(target)} »` : '';
  if (hasManualReview) {
    const justification = String(manualReview?.justification ?? '').trim();
    return justification
      ? `Conclusion validée par un opérateur : ${justification}`
      : 'Le verdict affiché a été validé manuellement par un opérateur.';
  }
  if (effectiveVerdict === 'conform' && expected === 'reject') {
    return `Le formulaire a correctement refusé la soumission${field} selon la règle testée.`;
  }
  if (effectiveVerdict === 'conform') {
    return 'Le formulaire a accepté les données valides comme prévu.';
  }
  if (effectiveVerdict === 'unexpected_acceptance') {
    return `Le formulaire a accepté des données qui auraient dû être refusées${field}.`;
  }
  if (effectiveVerdict === 'unexpected_rejection') {
    return 'Le formulaire a refusé un parcours qui aurait dû être accepté.';
  }
  if (effectiveVerdict === 'interrupted') {
    return 'Le test n’a pas pu atteindre une observation métier exploitable.';
  }
  if (effectiveVerdict === 'observation') {
    return `Le comportement observé est consigné sans créer d’anomalie automatique: ${OBSERVED_BEHAVIOR_LABELS[observed]}.`;
  }
  return 'Les preuves disponibles ne permettent pas encore de conclure.';
}
