import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchAuditList, fetchAuditReport, type AuditListOptions, type AuditListRow } from '@/services/auditListService';
import { normalizeAuditForRead } from '@/lib/auditReadUtils';
import { getAuditGlobalScore } from '@/data/mockAuditData';

export function auditReportKey(userId: string, row: AuditListRow) {
  return ['audit-report', userId, row.id, row.updated_at];
}

export function useAuditSummaries(options: AuditListOptions = {}) {
  const { user, userRole } = useAuth();
  const { projectId, latestPerProject = false, completedOnly = false } = options;
  const query = useQuery({
    queryKey: ['audit-list', user?.id, userRole, projectId ?? null, latestPerProject, completedOnly],
    enabled: !!user,
    // Refresh metadata while visible without streaming full report bodies.
    refetchInterval: 30_000,
    queryFn: ({ signal }) => fetchAuditList({ projectId, latestPerProject, completedOnly }, signal),
  });
  // Legacy reports keep the existing mapper; only relevant reports are fetched.
  // Their score work does not block the project metadata/list request.
  const legacyRows = useMemo(() => user ? (query.data ?? []).filter(row => row.requires_report) : [], [query.data, user?.id]);
  const legacy = useQueries({ queries: legacyRows.map(row => ({
    queryKey: auditReportKey(user!.id, row),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAuditReport(row, signal),
  })) });
  const normalizedReports = useMemo(() => new WeakMap<object, ReturnType<typeof normalizeAuditForRead>>(), []);
  const legacyById = new Map(legacyRows.map((row, index) => [row.id, legacy[index]]));
  const data = (query.data ?? []).map(row => {
    if (!row.requires_report) return row;
    const report = legacyById.get(row.id)?.data;
    if (report === undefined) return row;
    const cached = report && typeof report === 'object' && normalizedReports.has(report);
    const normalized = cached ? normalizedReports.get(report as object)! : normalizeAuditForRead(report, row.id, row);
    if (report && typeof report === 'object') normalizedReports.set(report, normalized);
    return { ...row, score: normalized ? getAuditGlobalScore(normalized) : null,
      axis_count: normalized?.axes.length ?? null, requires_report: false };
  });
  return { ...query, data, scoresLoading: legacy.some(item => item.isPending),
    refetchScores: async () => {
      const refreshed = await query.refetch();
      return Promise.all(legacyRows.flatMap((row, index) =>
        refreshed.data?.some(fresh => fresh.id === row.id && fresh.updated_at === row.updated_at)
          ? [legacy[index].refetch()] : []));
    },
    scoreError: legacy.find(item => item.error)?.error ?? null };
}
