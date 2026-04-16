import type { AuditReport } from '@/data/mockAuditData';
import { getAuditGlobalScore } from '@/data/mockAuditData';
import { normalizeAuditReportData } from '@/lib/normalizeAuditReport';

interface ProjectContext {
  url?: string | null;
  site_name?: string | null;
}

export function normalizeAuditForRead(
  rawReportData: unknown,
  auditId: string,
  project: ProjectContext,
): AuditReport | null {
  return normalizeAuditReportData(rawReportData, auditId, {
    url: project.url ?? '',
    site_name: project.site_name ?? 'Site',
  });
}

export function getAuditScoreFromAny(
  rawReportData: unknown,
  auditId: string,
  project: ProjectContext,
): number | null {
  const normalized = normalizeAuditForRead(rawReportData, auditId, project);
  if (!normalized) return null;
  return getAuditGlobalScore(normalized);
}
