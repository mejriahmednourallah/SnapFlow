import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mapper = readFileSync(resolve(__dirname, '../lib/auditMapper.ts'), 'utf8');

describe('ticket 17 RGPD frontend wording', () => {
  it('keeps simplification in the frontend mapper only', () => {
    expect(mapper).toContain('function rgpdBusinessIssue');
        expect(mapper).toMatch(/case 'rgpd':\s*return rgpdBusinessIssue\(finding\);/);

  });

  it('uses business plain French for common privacy findings', () => {
    expect(mapper).toContain('Les visiteurs ne disposent pas d un choix clair avant le depot de cookies ou traceurs.');
    expect(mapper).toContain('La page qui explique l utilisation des donnees personnelles est absente, difficile a trouver ou incomplete.');
    expect(mapper).toContain('La duree de conservation des donnees n est pas indiquee clairement aux visiteurs.');
    expect(mapper).toContain('Les visiteurs ne voient pas clairement comment exercer leurs droits sur leurs donnees.');
  });

  it('avoids backend or scanner contract changes for this ticket', () => {
    expect(mapper).toContain('Clarifier les informations visibles, expliquer les choix du visiteur');
    expect(mapper).not.toContain('backend RGPD rewrite');
    expect(mapper).not.toContain('scanner RGPD rewrite');
  });
});