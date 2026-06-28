import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pickMysteryVisitRunAt, isInsideMysteryVisitWindow } from '@/lib/mysteryVisitScheduling';

const currentDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(currentDir, '..');
const migration = readFileSync(resolve(root, '../supabase/migrations/20260628040000_project_perimeters_workflows_mystery_visit.sql'), 'utf8');
const activityDocument = readFileSync(resolve(root, 'components/activity/pdf/ActivityDocument.tsx'), 'utf8');
const activityReport = readFileSync(resolve(root, 'pages/ActivityReport.tsx'), 'utf8');
const formWorkflows = readFileSync(resolve(root, '../supabase/functions/form-workflows/index.ts'), 'utf8');
const executeScheduled = readFileSync(resolve(root, '../supabase/functions/execute-scheduled-reports/index.ts'), 'utf8');
const workflowList = readFileSync(resolve(root, 'components/form-tester/WorkflowList.tsx'), 'utf8');
const workflowDraft = readFileSync(resolve(root, 'components/form-tester/WorkflowRedmineDraftDialog.tsx'), 'utf8');
const projectFiche = readFileSync(resolve(root, 'pages/project/ProjectFiche.tsx'), 'utf8');
const tabDetails = readFileSync(resolve(root, 'components/audit/TabDetails.tsx'), 'utf8');
const reportSchedules = readFileSync(resolve(root, 'pages/ReportSchedules.tsx'), 'utf8');

describe('remaining ticket implementation contracts', () => {
  it('stores editable project perimeter blocks and hides PDF perimeter when empty', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.project_perimeter_blocks');
    expect(migration).toContain('items JSONB NOT NULL DEFAULT');
    expect(projectFiche).toContain('ProjectPerimeterEditor');
    expect(activityReport).toContain('project_perimeter_blocks');
    expect(activityReport).toContain('hasProjectPerimeterBlocks(perimeterBlocks)');
    expect(activityDocument).toContain('hasProjectPerimeterBlocks(perimeterBlocks)');
    expect(activityDocument).toContain('showPerimeter &&');
    expect(activityDocument).not.toContain('MAINTENANCE CORRECTIVE');
    expect(activityDocument).not.toContain('SYST');
  });

  it('links workflows to optional projects and surfaces them without creating audit constats', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects');
    expect(formWorkflows).toContain('project_id?: string | null');
    expect(formWorkflows).toContain('project_id.in.');
    expect(workflowList).toContain('selectedProjectId');
    expect(projectFiche).toContain('ProjectWorkflowSummary');
    expect(tabDetails).toContain('AuditWorkflowSummary');
    expect(workflowDraft).toContain('Aucun ticket n');
    expect(workflowDraft).toContain('createRedmineIssue');
  });

  it('adds one-time mystery visit schedules through UI and executor', () => {
    expect(migration).toContain("report_type IN ('audit', 'activity', 'mystery_visit')");
    expect(migration).toContain('mystery_randomized_run_at');
    expect(reportSchedules).toContain('mystery_visit');
    expect(reportSchedules).toContain('pickMysteryVisitRunAt');
    expect(executeScheduled).toContain("schedule.report_type === 'mystery_visit'");
    expect(executeScheduled).toContain('executed_at');
    expect(executeScheduled).toContain('Unsupported schedule type');
  });

  it('chooses mystery visit times inside the requested window and prefers conflict-free slots', () => {
    const window = {
      windowStart: '2026-06-30T08:00:00.000Z',
      windowEnd: '2026-07-02T18:00:00.000Z',
      allowedStartHour: 9,
      allowedEndHour: 17,
    };
    const picked = pickMysteryVisitRunAt(window, ['2026-06-30T09:15:00.000Z'], () => 0.5);
    const pickedDate = new Date(picked);
    expect(isInsideMysteryVisitWindow(pickedDate, window)).toBe(true);
    expect(Math.abs(pickedDate.getTime() - new Date('2026-06-30T09:15:00.000Z').getTime())).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  });
});
