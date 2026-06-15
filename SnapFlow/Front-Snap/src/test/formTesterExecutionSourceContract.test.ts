import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const executeFunctionSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/form-workflows-execute/index.ts'),
  'utf8',
);
const detectFunctionSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/form-workflows-detect/index.ts'),
  'utf8',
);
const suggestFunctionSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/form-workflows-suggest/index.ts'),
  'utf8',
);
const workflowFunctionSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const workflowBuilderHookSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../hooks/useFormWorkflowBuilder.ts'),
  'utf8',
);

describe('form-workflows-execute source contract', () => {
  it('queues a version-pinned execution atomically instead of simulating a browser run', () => {
    expect(executeFunctionSource).toContain("'form_test_enqueue_manual_execution'");
    expect(executeFunctionSource).toContain('p_scenario_version_id: body.scenario_version_id ?? null');
    expect(executeFunctionSource).toContain('scenario_version_id: scenarioVersion.id');
    expect(executeFunctionSource).toContain('deduplicated');
    expect(executeFunctionSource).not.toContain('createRuntimeScenarioVersion');
    expect(executeFunctionSource).not.toContain('simulateExecution(');
    expect(executeFunctionSource).not.toContain('Le workflow doit etre approuve avant execution');
  });

  it('does not generate an empty assertion during form detection', () => {
    expect(detectFunctionSource).not.toContain("value: '', label: 'Verifier message de succes'");
  });

  it('keeps review risk flags informational during form detection', () => {
    expect(detectFunctionSource).toContain("`signal:${riskFlags.filter((flag) => REVIEW_RISK_FLAGS.has(flag)).join(',')}`");
    expect(detectFunctionSource).toContain("function workflowStatusFor(_summary: DetectionSummary): 'draft'");
    expect(detectFunctionSource).not.toContain("return 'needs_review'");
    expect(detectFunctionSource).not.toContain("return 'blocked'");
  });

  it('generates executable node types from detected field types', () => {
    expect(detectFunctionSource).toContain('function nodeTypeForField');
    expect(detectFunctionSource).toContain("if (field.type === 'select') return 'select'");
    expect(detectFunctionSource).toContain("if (field.type === 'checkbox' || field.type === 'radio') return 'check'");
    expect(detectFunctionSource).toContain("if (field.type === 'file') return 'upload'");
    expect(detectFunctionSource).toContain('type: nodeTypeForField(field)');
    expect(detectFunctionSource).not.toContain("type: 'form_fill',");
  });
});

describe('form workflow field sensitivity source contract', () => {
  it('does not classify normal contact fields as secret-sensitive', () => {
    expect(detectFunctionSource).toContain('function isSensitiveField');
    expect(detectFunctionSource).not.toContain("['password', 'tel', 'email'].includes(field.type)");
  });

  it('does not exclude sensitive-flagged legacy rows from suggestions', () => {
    expect(suggestFunctionSource).not.toContain(".eq('is_sensitive', false)");
  });

  it('supports unquoted HTML attributes in static form detection', () => {
    expect(detectFunctionSource).toContain('const attrRegex =');
    expect(detectFunctionSource).toContain('match[4]');
    expect(detectFunctionSource).toContain("raw === 'true'");
    expect(detectFunctionSource).toContain('valueSelector');
  });

  it('selects only one AI-filled value per radio group', () => {
    expect(workflowBuilderHookSource).toContain('selectedRadioGroups');
    expect(workflowBuilderHookSource).toContain("field?.field_type !== 'radio'");
    expect(workflowBuilderHookSource).toContain("shouldSelect ? 'true' : 'false'");
  });

  it('allows administrators to submit accessible draft workflows', () => {
    expect(workflowFunctionSource).toContain('existingWorkflow.created_by !== userId && !isAdmin');
    expect(workflowFunctionSource).not.toContain(".eq('created_by', userId)\n        .eq('status', 'draft')");
  });
});
