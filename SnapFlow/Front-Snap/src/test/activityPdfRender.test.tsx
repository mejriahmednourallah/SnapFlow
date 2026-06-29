import path from 'node:path';
import { Font, pdf } from '@react-pdf/renderer';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDocument } from '@/components/activity/pdf/ActivityDocument';
import type { ActivityPdfOptions, DashboardProject, RedmineIssue } from '@/components/activity/pdf/pdfTypes';
import { PDF_THEMES } from '@/components/pdf/pdfStyles';

vi.mock('@/assets/snapflow-logo.png', () => ({
  default: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
}));

vi.mock('@/components/pdf/theme', () => {
  const PDF_THEMES = [{
    id: 'modern-slate',
    name: 'Slate',
    primary: '#10243C',
    accent: '#22A9D1',
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    border: '#D8DEE8',
    text: '#0B0F14',
    textMuted: '#5E6670',
    heroBg: '#22A9D1',
    heroText: '#FFFFFF',
    headerBg: '#22A9D1',
    headerBorder: '#D8DEE8',
    recBg: '#F5F7FA',
  }];

  return {
    DEFAULT_THEME: PDF_THEMES[0],
    PDF_THEMES,
    getStatusColor: (status: string) => status === 'danger' ? '#DC2626' : status === 'warning' ? '#F97316' : '#16A34A',
    makePageStyles: () => ({}),
  };
});

Font.register({
  family: 'DMSans',
  fonts: [
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'dm-sans', 'files', 'dm-sans-latin-400-normal.woff'),
      fontWeight: 400,
    },
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'dm-sans', 'files', 'dm-sans-latin-500-normal.woff'),
      fontWeight: 500,
    },
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'dm-sans', 'files', 'dm-sans-latin-600-normal.woff'),
      fontWeight: 600,
    },
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'dm-sans', 'files', 'dm-sans-latin-700-normal.woff'),
      fontWeight: 700,
    },
  ],
});

Font.register({
  family: 'PlayfairDisplay',
  fonts: [
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'playfair-display', 'files', 'playfair-display-latin-600-normal.woff'),
      fontWeight: 600,
    },
    {
      src: path.join(process.cwd(), 'node_modules', '@fontsource', 'playfair-display', 'files', 'playfair-display-latin-700-normal.woff'),
      fontWeight: 700,
    },
  ],
});

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
  subject: `Ticket ${id} - sujet de test pour le rapport d'activite`,
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
      issue(1, 'Cloture', 'Webmastering', 'Normale'),
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
