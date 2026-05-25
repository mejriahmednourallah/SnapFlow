import { describe, expect, it } from 'vitest';
import { isRedmineProjectUrl, resolveAuditTargetUrl, resolveRedmineProjectLink } from '@/lib/projectUrls';

describe('project URL resolution', () => {
  it('detects Redmine project URLs on the Medianet maintenance host', () => {
    expect(isRedmineProjectUrl('https://maintenance.medianet.tn/projects/cave')).toBe(true);
    expect(isRedmineProjectUrl('https://maintenance.medianet.tn/projects/cave/issues')).toBe(true);
  });

  it('does not treat a normal client website as Redmine', () => {
    expect(isRedmineProjectUrl('https://www.la-cave-privee.com/')).toBe(false);
  });

  it('resolves audits to the client homepage instead of the Redmine project link', () => {
    expect(resolveAuditTargetUrl(
      'https://maintenance.medianet.tn/projects/cave',
      'https://www.la-cave-privee.com/',
    )).toBe('https://www.la-cave-privee.com/');
  });

  it('returns no audit target when only a Redmine URL is known', () => {
    expect(resolveAuditTargetUrl('https://maintenance.medianet.tn/projects/cave')).toBe('');
  });

  it('keeps the Redmine link separate from the website URL', () => {
    expect(resolveRedmineProjectLink(
      'https://www.la-cave-privee.com/',
      'https://maintenance.medianet.tn/projects/cave',
    )).toBe('https://maintenance.medianet.tn/projects/cave');
  });
});
