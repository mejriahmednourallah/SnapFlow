import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

const evidenceDialog = readFileSync(resolve(currentDir, '../components/audit/EvidenceDetailsDialog.tsx'), 'utf8');
const kpiCard = readFileSync(resolve(currentDir, '../components/audit/KpiCard.tsx'), 'utf8');

describe('audit details CSV evidence cleanup', () => {
  it('keeps KPI context and CSV evidence while removing popup page links', () => {
    expect(evidenceDialog).toContain('finding.kpiLabels &&');
    expect(evidenceDialog).toContain('Table des preuves');
    expect(evidenceDialog).toContain('Telecharger CSV');
    expect(evidenceDialog).not.toContain('Pages concernees');
  });

  it('keeps narrative context collapsed by default after CSV evidence', () => {
    const csvIndex = evidenceDialog.indexOf('Table des preuves');
    const contextIndex = evidenceDialog.indexOf('Preuves et contexte');

    expect(evidenceDialog).toContain('<Accordion type="single" collapsible');
    expect(evidenceDialog).not.toContain('defaultValue=');
    expect(csvIndex).toBeGreaterThan(-1);
    expect(contextIndex).toBeGreaterThan(csvIndex);
  });

  it('does not remove card-level URL index blocks outside the popup', () => {
    expect(kpiCard).toContain('KpiUrlIndex');
  });
});
