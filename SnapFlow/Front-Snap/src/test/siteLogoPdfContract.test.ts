import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const activityPdf = readFileSync(resolve(currentDir, '../lib/generateActivityPdf.tsx'), 'utf8');
const auditPdf = readFileSync(resolve(currentDir, '../lib/generateAuditPdf.tsx'), 'utf8');
const auditReport = readFileSync(resolve(currentDir, '../pages/AuditReport.tsx'), 'utf8');
const detector = readFileSync(resolve(currentDir, '../../supabase/functions/detect-logo/index.ts'), 'utf8');

describe('PDF site logo contract', () => {
  it('uses the audited project URL for activity reports, never the Redmine URL', () => {
    expect(activityPdf).toContain('siteUrl: project.url');
    expect(activityPdf).not.toContain('project.redmine_url');
    expect(activityPdf).not.toContain('fetch(url)');
  });

  it('uses the audited URL for audit reports and passes the stored logo only as fallback', () => {
    expect(auditPdf).toContain('siteUrl: branding?.siteUrl ?? audit.url');
    expect(auditReport).toContain('siteUrl: projectInfo?.url ?? audit.url');
    expect(auditPdf).not.toContain('redmine_url');
    expect(auditPdf).not.toContain('fetch(url)');
  });

  it('detects page logos independently from HTML attribute order and validates image responses', () => {
    expect(detector).toContain('function attributesOf');
    expect(detector).toContain('attrs["aria-label"]');
    expect(detector).toContain('isImageResponse');
    expect(detector).toContain('source: "page-logo"');
    expect(detector).toContain('source: "stored-fallback"');
  });
});
