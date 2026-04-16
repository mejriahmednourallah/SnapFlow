import type { AuditReport } from '@/data/mockAuditData';
import { mapApiResponseToReport, type ApiResponse } from '@/lib/auditMapper';

function isAuditAxisArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && Array.isArray((item as any).findings));
}

function looksLikeMappedAuditReport(value: any): value is AuditReport {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.siteName === 'string' &&
    typeof value.globalScore === 'number' &&
    isAuditAxisArray(value.axes),
  );
}

export function normalizeAuditReportData(
  rawReportData: unknown,
  auditId: string,
  project: { url: string; site_name: string },
): AuditReport | null {
  if (!rawReportData || typeof rawReportData !== 'object') return null;
  if (looksLikeMappedAuditReport(rawReportData)) return rawReportData;
  return mapApiResponseToReport(rawReportData as ApiResponse, auditId, project);
}
