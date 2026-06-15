import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationSource = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260608013000_form_tester_v1_scenarios_versions.sql'),
  'utf8',
);
const workflowSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const approvalSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-approve/index.ts'),
  'utf8',
);
const executionSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-execute/index.ts'),
  'utf8',
);
const enqueueMigration = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260613010000_form_tester_manual_execution_dedup.sql'),
  'utf8',
);

describe('Form Tester Phase 1 scenario/version contract', () => {
  it('creates scenarios, immutable versions and execution foreign keys', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.form_test_scenarios');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.form_scenario_versions');
    expect(migrationSource).toContain('ADD COLUMN IF NOT EXISTS scenario_version_id UUID');
    expect(migrationSource).toContain('Approved scenario versions are immutable');
  });

  it('backfills one default scenario and initial version for historical workflows', () => {
    expect(migrationSource).toContain("'Scenario principal'");
    expect(migrationSource).toContain('WHERE NOT EXISTS');
    expect(migrationSource).toContain('version_number');
    expect(migrationSource).toContain('public.form_test_build_scenario_snapshot');
  });

  it('restricts snapshot version creation to the service role', () => {
    expect(migrationSource).toContain(
      'REVOKE ALL ON FUNCTION public.form_test_create_scenario_version(UUID, UUID, TEXT, TEXT) FROM PUBLIC',
    );
    expect(migrationSource).toContain(
      'GRANT EXECUTE ON FUNCTION public.form_test_create_scenario_version(UUID, UUID, TEXT, TEXT) TO service_role',
    );
  });

  it('creates a pending version on submission and approves that exact version', () => {
    expect(workflowSource).toContain("'form_test_create_scenario_version'");
    expect(workflowSource).toContain("p_status: 'pending'");
    expect(approvalSource).toContain(".from('form_scenario_versions')");
    expect(approvalSource).toContain("status: 'approved'");
  });

  it('executes the approved snapshot and records exact provenance', () => {
    expect(executionSource).toContain("'form_test_enqueue_manual_execution'");
    expect(enqueueMigration).toContain('public.form_test_build_scenario_snapshot');
    expect(enqueueMigration).toContain("'scenario_version', to_jsonb(version_row)");
    expect(executionSource).toContain("scenario_version_id: scenarioVersion.id");
    expect(executionSource).toContain("scenario_checksum: scenarioVersion.checksum");
    expect(executionSource).not.toContain(
      "serviceClient.from('workflow_nodes').select('*').eq('workflow_id', workflowId)",
    );
  });

  it('queues the approved snapshot for the future browser executor', () => {
    expect(enqueueMigration).toContain("'queued'");
    expect(enqueueMigration).toContain("'pending_executor'");
    expect(enqueueMigration).toContain('step_count');
    expect(executionSource).toContain('savedResult.progress_total');
  });
});
