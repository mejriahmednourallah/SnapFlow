import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workflowFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const suggestFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-suggest/index.ts'),
  'utf8',
);
const detectFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-detect/index.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260608018000_form_tester_branching_ai_cases.sql'),
  'utf8',
);

describe('Form Tester branching and AI cases contract', () => {
  it('persists typed branches and scenario expectations in snapshots', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS branch_key');
    expect(migration).toContain("'success', 'failure', 'true', 'false'");
    expect(migration).toContain("'expected_outcome', scenario.expected_outcome");
    expect(migration).toContain("'branch_key', edge.branch_key");
  });

  it('clones AI cases without sharing graph node ids', () => {
    expect(migration).toContain('form_test_clone_scenario_case');
    expect(migration).toContain('new_node_id := gen_random_uuid()');
    expect(migration).toContain('node_map');
    expect(workflowFunction).toContain("action === 'create_test_cases'");
  });

  it('validates branch compatibility and rejects cycles server-side', () => {
    expect(workflowFunction).toContain('createsGraphCycle');
    expect(workflowFunction).toContain('Branche incompatible avec le noeud source');
    expect(workflowFunction).toContain('Cette connexion creerait une boucle');
  });

  it('generates nominal and controlled failure cases with a deterministic fallback', () => {
    expect(suggestFunction).toContain('heuristicTestCases');
    expect(suggestFunction).toContain("'validation_error'");
    expect(suggestFunction).toContain("'form_invalid'");
    expect(suggestFunction).toContain("provider = 'heuristic'");
  });

  it('protects customized branches from accidental form re-detection', () => {
    expect(detectFunction).toContain('force_reset');
    expect(detectFunction).toContain('branches personnalisees');
    expect(detectFunction).toContain(".neq('branch_key', 'default')");
  });
});
