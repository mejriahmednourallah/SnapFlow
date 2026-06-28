import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const readSource = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8');

describe('ticket 9 Super Admin PDF branding settings', () => {
  const roleLabels = readSource('lib/roleLabels.ts');
  const appSettings = readSource('lib/appSettings.ts');
  const adminSettings = readSource('pages/AdminSettings.tsx');
  const activityReport = readSource('pages/ActivityReport.tsx');
  const migration = readFileSync(resolve(root, '../supabase/migrations/20260627090000_app_settings_activity_pdf_branding.sql'), 'utf8');

  it('keeps admin as the internal role and exposes Super Admin as visible wording', () => {
    expect(roleLabels).toContain("admin: 'Super Admin'");
    expect(roleLabels).toContain("{ value: 'admin', label: ROLE_LABELS.admin }");
  });

  it('stores global activity PDF branding defaults behind admin-managed app settings', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.app_settings');
    expect(migration).toContain("('activity_pdf_brand_left', 'MEDIANET RUN SERVICES')");
    expect(migration).toContain("('activity_pdf_brand_right', 'SNAPFLOW')");
    expect(migration).toContain("public.has_role(auth.uid(), 'admin')");
    expect(appSettings).toContain('fetchActivityPdfBrandDefaults');
    expect(appSettings).toContain('saveActivityPdfBrandDefaults');
  });

  it('wires Super Admin settings into the activity PDF export defaults without removing modal overrides', () => {
    expect(adminSettings).toContain('saveActivityPdfBrandDefaults');
    expect(adminSettings).toContain('Acces reserve aux Super Admins');
    expect(activityReport).toContain('fetchActivityPdfBrandDefaults()');
    expect(activityReport).toContain('setPdfBrandLeft(defaults.left)');
    expect(activityReport).toContain('setPdfBrandRight(defaults.right)');
    expect(activityReport).toContain('brandLeft: pdfBrandLeft');
    expect(activityReport).toContain('brandRight: pdfBrandRight');
  });
});