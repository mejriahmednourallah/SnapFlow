import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

describe('Activity PDF cover contract', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/components/activity/pdf/ActivityDocument.tsx'),
    'utf8',
  );

  it('shows the selected period only once on the cover', () => {
    const summaryBlock = source.match(
      /function filterSummary[\s\S]*?\n}\n\nfunction periodLabel/,
    )?.[0] ?? '';

    expect(summaryBlock).not.toContain('dateFrom');
    expect(summaryBlock).not.toContain('dateTo');
    expect(source).toContain('{periodLabel(filters)}');
  });

  it('uses the manual activity deck visual constants', () => {
    expect(source).toContain("const SLIDE_PAGE = { size: [1440, 810] as [number, number] }");
    expect(source).toContain("const MANUAL_CYAN = '#22A9D1'");
    expect(source).toContain("const MANUAL_SLATE = '#10243C'");
    expect(source).toContain("const MANUAL_YELLOW = '#F6B21A'");
    expect(source).toContain("const MANUAL_GRID_WHITE = 'rgba(255,255,255,0.72)'");
  });

  it('keeps perimeter pages dynamic and omitted when no configured blocks exist', () => {
    expect(source).toContain('const showPerimeter = options.sections.perimetre !== false && hasProjectPerimeterBlocks(perimeterBlocks)');
    expect(source).toContain("showPerimeter ? 'Périmètre' : null");
    expect(source).toContain('{showPerimeter && (');
    expect(source).toContain('<PerimetrePage');
  });

  it('renders validation and acknowledged ticket detail pages from real Redmine fields only', () => {
    expect(source).toContain('showValidationDetails: data.testingTickets.length > 0');
    expect(source).toContain('showAcknowledgedDetails: data.acknowledgedTickets.length > 0');
    expect(source).toContain('function TicketNarrativePage');
    expect(source).toContain('issue.tracker.name');
    expect(source).toContain('issue.id');
    expect(source).toContain('issue.subject');
    expect(source).toContain('issue.priority.name');
    expect(source).not.toContain('Feature #11547');
    expect(source).not.toContain('Documentation et reporting #11379');
  });

  it('does not pass empty string children into React PDF views', () => {
    expect(source).toContain("const contactLine = [options.contactEmail, options.contactWeb, options.contactWeb2].filter(Boolean).join(' | ')");
    expect(source).toContain('{contactLine ? (');
    expect(source).not.toContain('{(options.contactEmail || options.contactWeb || options.contactWeb2) && (');
  });

  it('uses manual-style French headings and captions', () => {
    expect(source).toContain("RAPPORT D'ACTIVITÉ");
    expect(source).toContain('SOMMAIRE');
    expect(source).toContain('INDICATEURS GLOBAUX');
    expect(source).toContain('ÉTAT DES TICKETS');
    expect(source).toContain('TYPOLOGIE DES TICKETS');
    expect(source).toContain('PRIORITÉ DES TICKETS');
    expect(source).toContain('DÉTAILS DES TICKETS EN COURS DE TRAITEMENT');
  });
});
