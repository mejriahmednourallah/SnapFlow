import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

const readSource = (relativePath: string) => readFileSync(resolve(currentDir, '..', relativePath), 'utf8');

const activityReport = readSource('pages/ActivityReport.tsx');
const tabDetails = readSource('components/audit/TabDetails.tsx');
const adminProjects = readSource('pages/AdminProjects.tsx');
const workflowList = readSource('components/form-tester/WorkflowList.tsx');
const coverPage = readSource('components/pdf/pages/CoverPage.tsx');

describe('remaining ticket 12 activity cleanup', () => {
  it('keeps treatment stats separate from Redmine request pagination', () => {
    expect(activityReport).not.toContain(": '0 ticket(s)'}");
    expect(activityReport).toContain('Tickets traitement');
    expect(activityReport).toContain('treatmentStatsSource.length');
    expect(activityReport).toContain('demande(s) Redmine');
    expect(activityReport).not.toContain('sur ${totalCount} ticket(s)');
  });
});

describe('remaining ticket 5 visible date cleanup', () => {
  it('uses shared date helpers on targeted visible date surfaces', () => {
    for (const source of [tabDetails, adminProjects, workflowList, coverPage]) {
      expect(source).toContain('formatDate');
      expect(source).not.toContain("toLocaleDateString('fr-FR')");
    }
  });
});
