export function isRedmineProjectUrl(value: string | null | undefined): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isKnownRedmineHost = host.includes('redmine') || host === 'maintenance.medianet.tn';
    return isKnownRedmineHost && /^\/projects\/[^/]+(?:\/.*)?$/.test(path);
  } catch {
    const lowered = raw.toLowerCase();
    return (
      (lowered.includes('redmine') || lowered.includes('maintenance.medianet.tn')) &&
      /\/projects\/[a-z0-9_-]+(?:\/.*)?$/.test(lowered)
    );
  }
}

export function normalizeAuditUrl(projectUrl: string): string {
  const raw = projectUrl.trim();
  if (!raw) return raw;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function resolveAuditTargetUrl(projectUrl: string | null | undefined, redmineHomepage?: string | null): string {
  const primaryUrl = String(projectUrl || '').trim();
  const homepage = String(redmineHomepage || '').trim();

  if (primaryUrl && !isRedmineProjectUrl(primaryUrl)) return primaryUrl;
  if (homepage && !isRedmineProjectUrl(homepage)) return homepage;
  return '';
}

export function resolveProjectWebsiteUrl(projectUrl: string | null | undefined, redmineHomepage?: string | null): string {
  return resolveAuditTargetUrl(projectUrl, redmineHomepage);
}

export function resolveRedmineProjectLink(projectUrl: string | null | undefined, redmineUrl?: string | null): string {
  const explicitRedmineUrl = String(redmineUrl || '').trim();
  if (isRedmineProjectUrl(explicitRedmineUrl)) return explicitRedmineUrl;

  const legacyProjectUrl = String(projectUrl || '').trim();
  if (isRedmineProjectUrl(legacyProjectUrl)) return legacyProjectUrl;

  return explicitRedmineUrl;
}
