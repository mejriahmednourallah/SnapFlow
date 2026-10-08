import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/audit-list-scores.json';
import { getAuditScoreFromAny, normalizeAuditForRead } from '@/lib/auditReadUtils';

describe('audit list score compatibility', () => {
  for (const fixture of fixtures.filter(item => !item.legacy)) {
    it(fixture.name, () => {
      expect(getAuditScoreFromAny(fixture.report, 'test', { site_name: 'Site', url: 'https://example.com' })).toBe(fixture.score);
      expect(normalizeAuditForRead(fixture.report, 'test', {})?.axes.length ?? null).toBe(fixture.axes);
    });
  }
});
