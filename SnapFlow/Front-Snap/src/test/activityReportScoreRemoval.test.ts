import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

const activityDashboard = readFileSync(resolve(currentDir, '../components/activity/ActivityDashboard.tsx'), 'utf8');
const activityDocument = readFileSync(resolve(currentDir, '../components/activity/pdf/ActivityDocument.tsx'), 'utf8');
const pdfSlides = readFileSync(resolve(currentDir, '../components/activity/pdf/PdfSlides.tsx'), 'utf8');
const pdfTypes = readFileSync(resolve(currentDir, '../components/activity/pdf/pdfTypes.ts'), 'utf8');

describe('activity report score removal', () => {
  it('removes visible health score and radar scoring surfaces from activity reports', () => {
    const visibleActivitySources = [activityDashboard, activityDocument, pdfSlides].join('\n');

    expect(visibleActivitySources).not.toContain('Score de santé');
    expect(visibleActivitySources).not.toContain('Décomposition du score');
    expect(visibleActivitySources).not.toContain('Profil de santé');
    expect(visibleActivitySources).not.toContain('data-pdf-slide="health"');
    expect(visibleActivitySources).not.toContain('RadarChart');
    expect(visibleActivitySources).not.toContain('healthStatus');
    expect(visibleActivitySources).not.toContain('data.health');
    expect(pdfTypes).not.toContain('radarData');
  });
});
