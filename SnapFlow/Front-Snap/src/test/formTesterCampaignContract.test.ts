import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

describe('Form Tester campaign backend contract', () => {
  it('creates campaign storage, dependencies and transactional launch RPC', () => {
    const sql = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260615010000_form_tester_business_campaigns.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.form_test_campaigns');
    expect(sql).toContain('depends_on_execution_id');
    expect(sql).toContain('form_test_launch_campaign');
    expect(sql).toContain('form_test_refresh_campaign');
    const dualSql = fs.readFileSync(
      path.join(root, 'supabase/migrations/20260615020000_form_tester_dual_baseline_oracle.sql'),
      'utf8',
    );
    expect(dualSql).toContain('baseline_execution_ids');
    expect(dualSql).toContain('reference_execution_id');
    expect(dualSql).toContain('form_test_select_campaign_reference');
    expect(dualSql).toContain('form_test_launch_campaign_v2');
    const executorStorage = fs.readFileSync(
      path.resolve(root, '../V3-Microservices/v3-form-executor/storage.py'),
      'utf8',
    );
    expect(executorStorage).toContain("result.campaign_role IS DISTINCT FROM 'case'");
    expect(executorStorage).toContain('campaign.reference_execution_id IS NOT NULL');
  });

  it('exposes campaign launch, history, detail and review actions', () => {
    const source = fs.readFileSync(
      path.join(root, 'supabase/functions/form-test-campaigns/index.ts'),
      'utf8',
    );
    expect(source).toContain("action === 'launch'");
    expect(source).toContain("action === 'list'");
    expect(source).toContain("action === 'get'");
    expect(source).toContain("action === 'review'");
    expect(source).toContain("action === 'interpret'");
    expect(source).toContain("'form_test_launch_campaign_v2'");
  });

  it('uses the dual-baseline collection throughout the campaign workspace', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/components/form-tester/CampaignPlanWorkspace.tsx'),
      'utf8',
    );
    expect(source).toContain('baselineIds.includes(scenario.id)');
    expect(source).not.toMatch(/\bbaselineId\b/);
  });
});
