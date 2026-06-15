import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(currentDir, '../..');
const repositoryRoot = resolve(frontendRoot, '..');

const detectorSource = readFileSync(
  resolve(frontendRoot, 'supabase/functions/form-workflows-detect/index.ts'),
  'utf8',
);
const executeSource = readFileSync(
  resolve(frontendRoot, 'supabase/functions/form-workflows-execute/index.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(frontendRoot, 'supabase/migrations/20260613010000_form_tester_manual_execution_dedup.sql'),
  'utf8',
);
const browserPoolSource = readFileSync(
  resolve(repositoryRoot, 'V3-Microservices/v3-browser-pool/pool.py'),
  'utf8',
);
const builderHookSource = readFileSync(
  resolve(frontendRoot, 'src/hooks/useFormWorkflowBuilder.ts'),
  'utf8',
);

describe('Form Tester technical-field and execution dedup contracts', () => {
  it('filters raw hidden and browser-managed fields before workflow creation', () => {
    expect(detectorSource).toContain("if (rawType === 'hidden') return 'hidden_field'");
    expect(detectorSource).toContain("'captcha_sid'");
    expect(detectorSource).toContain("'g-recaptcha-response'");
    expect(detectorSource).toContain('rejected_candidates');
  });

  it('only qualifies radio and checkbox selectors with their value', () => {
    expect(detectorSource).toContain("['checkbox', 'radio'].includes(type) && value");
    expect(browserPoolSource).toContain('["checkbox", "radio"].includes(type) && value');
  });

  it('ranks forms independently instead of merging every form on the page', () => {
    expect(detectorSource).toContain('rankFormCandidates');
    expect(detectorSource).toContain('selected_form_identity');
    expect(detectorSource).toContain('selection_required');
    expect(detectorSource).toContain('form_candidates');
    expect(detectorSource).toContain('countStaticForms(staticDetection.html) > 1');
  });

  it('enqueues manual executions through the atomic scenario RPC', () => {
    expect(executeSource).toContain("'form_test_enqueue_manual_execution'");
    expect(executeSource).toContain('deduplicated');
    expect(migrationSource).toContain('pg_advisory_xact_lock');
    expect(migrationSource).toContain('idx_workflow_results_one_active_manual_scenario');
    expect(migrationSource).toContain("'deduplicated', true");
  });

  it('blocks rapid repeated execution requests before React state catches up', () => {
    expect(builderHookSource).toContain('const executionRequestRef = useRef(false)');
    expect(builderHookSource).toContain('if (executionRequestRef.current) return');
  });
});
