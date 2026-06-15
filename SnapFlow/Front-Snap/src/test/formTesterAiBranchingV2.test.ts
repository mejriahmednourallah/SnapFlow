import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const suggestSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-suggest/index.ts'),
  'utf8',
);
const workflowSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const suiteSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/_shared/formTestSuite.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260610010000_form_tester_ai_branching_v2.sql'),
  'utf8',
);

describe('Form Tester AI branching V2 contract', () => {
  it('uses a dynamic four to twelve case budget', () => {
    expect(suiteSource).toContain('Math.max(4, Math.min(12');
    expect(workflowSource).toContain('body.test_cases.slice(0, 12)');
    expect(migration).toContain('Generated suite exceeds the 12 case limit');
  });

  it('keeps business rejection distinct from technical failure', () => {
    expect(suiteSource).toContain("'business_rejection'");
    expect(workflowSource).toContain("'business_rejection'");
    expect(migration).toContain("'business_rejection'");
  });

  it('does not compile hallucinated route selectors', () => {
    expect(suggestSource).toContain('allowedRouteSelectors');
    expect(workflowSource).toContain('utilise un selecteur de parcours non detecte');
    expect(workflowSource).toContain("type === 'click'");
    expect(workflowSource).toContain("type === 'wait'");
  });

  it('validates oracle signals and applies the suite atomically', () => {
    expect(workflowSource).toContain('ALLOWED_ORACLE_SIGNALS');
    expect(workflowSource).toContain('compileOracleSignals');
    expect(workflowSource).toContain("'form_test_apply_generated_suite'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.form_test_apply_generated_suite');
  });

  it('allows field-scoped and form-scoped negative validation scenarios', () => {
    expect(suiteSource).toContain("validation_scope?: 'field' | 'form'");
    expect(suiteSource).toContain('target_field_id');
    expect(workflowSource).toContain('inferValidationTarget');
    expect(workflowSource).toContain("testCase.validation_scope === 'form'");
    expect(workflowSource).not.toContain('doit cibler le champ dont la validation est testee');
  });

  it('compiles post-submit observation and true/false branches', () => {
    expect(migration).toContain("'inspect_response'");
    expect(migration).toContain("'submission_outcome'");
    expect(migration).toContain("condition_node_id, success_assert_id, 'true'");
    expect(migration).toContain("condition_node_id, failure_capture_id, 'false'");
  });
});
