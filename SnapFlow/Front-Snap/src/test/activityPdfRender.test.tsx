import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ActivityDocument } from '@/components/activity/pdf/ActivityDocument';
import type { ActivityPdfOptions, DashboardProject, RedmineIssue } from '@/components/activity/pdf/pdfTypes';
import { PDF_THEMES } from '@/components/pdf/pdfStyles';

const project: DashboardProject = {
  id: 'project-1',
  site_name: 'Fatales',
  url: 'https://www.fatales.tn',
  logo_url: null,
};

const options: ActivityPdfOptions = {
  theme: PDF_THEMES[0],
  themeId: PDF_THEMES[0].id,
  pdfColor: '#22A9D1',
  sections: {
    sommaire: true,
    perimetre: false,
    merci: true,
  },
  coverKpis: {},
  brandLeft: 'RUN SERVICES',
  brandRight: 'SNAPFLOW',
  contactEmail: '',
  contactWeb: '',
  contactWeb2: '',
};

const issue = (id: number, status: string, tracker: string, priority: string): RedmineIssue => ({
  id,
  subject: `Ticket ${id} - sujet de test pour le rapport d'activité`,
  status: { id: 1, name: status },
  tracker: { id: 1, name: tracker },
  priority: { id: 1, name: priority },
  author: { id: 1, name: 'SnapFlow' },
  created_on: '2026-01-02T10:00:00Z',
  updated_on: '2026-01-05T10:00:00Z',
  done_ratio: 0,
});

describe('activity PDF render smoke test', () => {
  it('renders a PDF blob when optional contact fields are empty', async () => {
    const issues = [
      issue(1, 'Clôturé', 'Webmastering', 'Normale'),
      issue(2, 'En cours de traitement', 'Bug', 'Majeure'),
      issue(3, 'En cours de validation', 'Feature', 'Mineure'),
      issue(4, 'Pris en charge', 'Documentation et reporting', 'Normale'),
    ];

    const blob = await pdf(
      <ActivityDocument
        project={project}
        issues={issues}
        totalCount={issues.length}
        options={options}
        perimeterBlocks={[]}
      />,
    ).toBlob();

    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });
});
