import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(__dirname, '..');
const allowedExtensions = new Set(['.ts', '.tsx']);

function collectSources(dir: string): Array<{ path: string; source: string }> {
  const entries: Array<{ path: string; source: string }> = [];

  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (['node_modules', 'dist'].includes(name)) continue;
      entries.push(...collectSources(fullPath));
      continue;
    }

    if (![...allowedExtensions].some((extension) => fullPath.endsWith(extension))) continue;
    entries.push({
      path: relative(root, fullPath),
      source: readFileSync(fullPath, 'utf8'),
    });
  }

  return entries;
}

describe('ticket 6 perimeter terminology', () => {
  it('does not expose legacy sous-domaines wording in frontend source', () => {
    const legacyPattern = /sous[-\s]?domaines?|sub[-_\s]?domains?/i;
    const offenders = collectSources(root)
      .filter(({ path }) => !path.includes('perimeterTerminology.test.ts'))
      .filter(({ source }) => legacyPattern.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps perimeter wording available in report surfaces', () => {
    const activityDocument = readFileSync(join(root, 'components/activity/pdf/ActivityDocument.tsx'), 'utf8');
    const pdfSlides = readFileSync(join(root, 'components/activity/pdf/PdfSlides.tsx'), 'utf8');

    expect(`${activityDocument}\n${pdfSlides}`).toMatch(/p[ée]rim[èe]tre/i);
  });
});
