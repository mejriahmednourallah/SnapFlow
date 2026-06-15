import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260612020000_form_tester_persistence_scheduling.sql'),
  'utf8',
);
const cleanupMigration = readFileSync(
  resolve(currentDir, '../../supabase/migrations/20260612021000_form_tester_version_cascade_cleanup.sql'),
  'utf8',
);
const workflowFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const scheduleFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflow-schedules/index.ts'),
  'utf8',
);
const schedulingPanel = readFileSync(
  resolve(currentDir, '../components/form-tester/builder/SchedulePanel.tsx'),
  'utf8',
);
const executorStorage = readFileSync(
  resolve(currentDir, '../../../V3-Microservices/v3-form-executor/storage.py'),
  'utf8',
);
const localBootstrap = readFileSync(
  resolve(currentDir, '../../scripts/local-supabase-preprod.sh'),
  'utf8',
);
const aiFunction = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-suggest/index.ts'),
  'utf8',
);

describe('Form Tester persistence and scheduling contract', () => {
  it('creates the workflow and default scenario atomically', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.form_test_create_workflow');
    expect(migration).toContain("INSERT INTO public.form_workflows");
    expect(migration).toContain("INSERT INTO public.form_test_scenarios");
    expect(workflowFunction).toContain("serviceClient.rpc('form_test_create_workflow'");
  });

  it('separates personal workflows from the review queue', () => {
    expect(workflowFunction).toContain("'review_queue'");
    expect(workflowFunction).toContain("query.in('status', ['pending', 'needs_review'])");
    expect(workflowFunction).toContain("requestedView === 'mine'");
  });

  it('pins approved snapshots and prevents duplicate scheduled occurrences', () => {
    expect(migration).toContain('scenario_version_id UUID NOT NULL');
    expect(migration).toContain("status,\n    checksum,\n    snapshot");
    expect(migration).toContain("UNIQUE (schedule_id, scheduled_for)");
    expect(migration).toContain("'scheduled'");
    expect(scheduleFunction).toContain("action === 'refresh_snapshot'");
  });

  it('keeps approved snapshots immutable without blocking parent workflow cleanup', () => {
    expect(cleanupMigration).toContain("OLD.status = 'approved'");
    expect(cleanupMigration).toContain('FROM public.form_workflows workflow');
    expect(cleanupMigration).toContain("RAISE EXCEPTION 'Approved scenario versions are immutable'");
  });

  it('keeps a later occurrence queued while the same schedule is active', () => {
    expect(executorStorage).toContain('active.schedule_id = result.schedule_id');
    expect(executorStorage).toContain("active.status IN ('running', 'stopping')");
  });

  it('exposes scheduling controls in the workflow builder', () => {
    expect(schedulingPanel).toContain('Planifier ce scenario');
    expect(schedulingPanel).toContain('createSchedule');
    expect(schedulingPanel).toContain('runScheduleNow');
    expect(schedulingPanel).toContain('refreshScheduleSnapshot');
  });

  it('uses Gemini server-side and preserves the heuristic fallback', () => {
    expect(aiFunction).toContain("Deno.env.get('GEMINI_API_KEY')");
    expect(aiFunction).not.toContain("Deno.env.get('GROQ_API_KEY')");
    expect(aiFunction).toContain("provider = 'heuristic'");
    expect(localBootstrap).toContain('GEMINI_API_KEY=$GEMINI_API_KEY');
    expect(localBootstrap).not.toContain('VITE_GEMINI');
  });
});
