import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

describe('Activity PDF cover contract', () => {
  it('shows the selected period only once on the cover', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/components/activity/pdf/ActivityDocument.tsx'),
      'utf8',
    );
    const summaryBlock = source.match(
      /function filterSummary[\s\S]*?\n}\n\nfunction periodLabel/,
    )?.[0] ?? '';

    expect(summaryBlock).not.toContain('dateFrom');
    expect(summaryBlock).not.toContain('dateTo');
    expect(source).toContain('{periodLabel(filters)}');
  });
});
