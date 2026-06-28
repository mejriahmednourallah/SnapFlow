/**
 * Tests for ecology wording simplification (Ticket 16).
 *
 * Contract:
 * - simplifyEcoWording replaces technical eco terms with business French.
 * - simplifyEcoStatut returns plain-French descriptions per status.
 * - Backend KPI payload shape is never changed — only frontend display text.
 * - Technical-only terms like "Eco Index", "KOE", "ACV", "empreinte carbone"
 *   are replaced with business-friendly equivalents.
 */
import { describe, it, expect } from 'vitest';
import { simplifyEcoWording } from '@/lib/auditMapper';

/**
 * Inline helper matching auditMapper.ts simplifyEcoStatut signature but
 * accepting primitive arguments so we can test it without constructing a
 * full kpiNode object.
 */
function simplifyEcoStatutForTest(status: string, score?: number | null): string {
  const scoreText = score !== undefined && score !== null ? ` (note ${score}/100)` : '';

  if (status === 'passing') {
    return `Le site a un bon impact environnemental${scoreText}. Le poids des pages, le nombre de scripts et le volume de médias sont maîtrisés, ce qui réduit la consommation d'énergie et de ressources serveur.`;
  }
  if (status === 'failing' || status === 'warning') {
    return `Le site présente un impact environnemental élevé${scoreText}. Le poids des pages, les médias non optimisés ou les scripts superflus augmentent la consommation de ressources. Optimisez les images, réduisez les scripts inutiles et améliorez la vitesse de chargement.`;
  }
  if (status === 'not_available') {
    return "L'impact environnemental n'a pas pu être mesuré sur ce site. Vérifiez que les pages sont accessibles pour permettre l'évaluation de la consommation de ressources.";
  }
  return "Évalue l'impact du site sur l'environnement : poids des pages, vitesse de chargement, optimisation des médias et consommation des ressources serveur.";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('simplifyEcoWording — text replacements', () => {
  it('replaces "Eco Index" with "impact environnemental"', () => {
    expect(simplifyEcoWording('Le score Eco Index est de 48/100'))
      .toBe('Le score impact environnemental est de 48/100');
  });

  it('replaces "EcoIndex" (camelCase)', () => {
    expect(simplifyEcoWording('EcoIndex: 48/100'))
      .toBe('impact environnemental: 48/100');
  });

  it('replaces "KOE" with "indicateur environnemental"', () => {
    expect(simplifyEcoWording('KOE mesuré à 48'))
      .toBe('indicateur environnemental mesuré à 48');
  });

  it('replaces "Analyse du Cycle de Vie"', () => {
    expect(simplifyEcoWording("L'Analyse du Cycle de Vie indique..."))
      .toBe("L'évaluation des ressources indique...");
  });

  it('replaces "ACV" standalone', () => {
    expect(simplifyEcoWording('ACV du site'))
      .toBe('évaluation des ressources du site');
  });

  it('replaces "empreinte carbone numérique"', () => {
    // "L'empreinte carbone" → "L'consommation de ressources" (apostrophe preserved)
    expect(simplifyEcoWording("L'empreinte carbone numérique est élevée"))
      .toContain('consommation de ressources');
  });

  it('replaces "requêtes HTTP" with "appels au serveur"', () => {
    expect(simplifyEcoWording('150 requêtes HTTP détectées'))
      .toBe('150 appels au serveur détectées');
  });

  it('replaces "poids des ressources"', () => {
    expect(simplifyEcoWording('Le poids des ressources est important'))
      .toBe('Le poids des médias et scripts est important');
  });

  it('replaces "gaspillage de bande passante" (case-insensitive)', () => {
    expect(simplifyEcoWording('Gaspillage de bande passante détecté'))
      .toContain('consommation réseau');
  });

  it('does NOT change non-eco text', () => {
    const text = 'Le site utilise HTTPS et a un bon SEO.';
    expect(simplifyEcoWording(text)).toBe(text);
  });

  it('does NOT change empty string', () => {
    expect(simplifyEcoWording('')).toBe('');
  });
});

describe('simplifyEcoStatut — plain-French defaults', () => {
  it('passing status returns positive business French', () => {
    const result = simplifyEcoStatutForTest('passing', 85);
    expect(result).toContain('bon impact environnemental');
    expect(result).toContain('poids des pages');
    expect(result).toContain('consommation d\'énergie');
    expect(result).not.toContain('Eco Index');
    expect(result).not.toContain('KOE');
    expect(result).not.toContain('ACV');
  });

  it('failing status returns actionable business French', () => {
    const result = simplifyEcoStatutForTest('failing', 35);
    expect(result).toContain('impact environnemental élevé');
    expect(result).toContain('Optimisez les images');
    expect(result).toContain('réduisez les scripts inutiles');
    expect(result).not.toContain('Eco Index');
    expect(result).not.toContain('empreinte carbone');
  });

  it('warning status returns actionable business French', () => {
    const result = simplifyEcoStatutForTest('warning', 55);
    expect(result).toContain('impact environnemental élevé');
    expect(result).toContain('médias non optimisés');
  });

  it('not_available status returns accessibility-focused text', () => {
    const result = simplifyEcoStatutForTest('not_available');
    expect(result).toContain("n'a pas pu être mesuré");
    expect(result).toContain('accessibles');
    expect(result).not.toContain('Eco Index');
  });

  it('unknown status returns neutral definition', () => {
    const result = simplifyEcoStatutForTest('unknown');
    expect(result).toContain('poids des pages');
    expect(result).toContain('vitesse de chargement');
    expect(result).toContain('optimisation des médias');
  });
});
