import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationSource = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260608015000_form_tester_phase2_execution_queue.sql'),
  'utf8',
);
const executionsSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-executions/index.ts'),
  'utf8',
);
const controlSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-execution-control/index.ts'),
  'utf8',
);

describe('Form Tester Phase 2 contract', () => {
  it('creates progressive execution tables and the complete status vocabulary', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.workflow_step_results');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.workflow_logs');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.workflow_artifacts');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.workflow_execution_commands');
    for (const status of ['queued', 'running', 'stopping', 'passed', 'failed', 'cancelled']) {
      expect(migrationSource).toContain(`'${status}'`);
    }
  });

  it('redacts sensitive JSON before persistence and prepares Realtime', () => {
    expect(migrationSource).toContain('public.form_test_redact_jsonb');
    expect(migrationSource).toContain('trg_workflow_logs_redact');
    expect(migrationSource).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
    expect(migrationSource).toContain("'form-test-artifacts'");
  });

  it('returns progressive details and supports stop commands', () => {
    expect(executionsSource).toContain(".from('workflow_step_results')");
    expect(executionsSource).toContain(".from('workflow_logs')");
    expect(controlSource).toContain("body.command === 'stop'");
    expect(controlSource).toContain("execution.status === 'queued' ? 'cancelled' : 'stopping'");
  });
});
