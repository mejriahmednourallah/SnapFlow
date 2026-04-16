import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { fetchIssues, type RedmineIssue, type FetchIssuesParams } from '@/services/redmineService';

const PAGE_SIZE = 25;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = { issues: RedmineIssue[]; totalCount: number; ts: number };
// Module-level cache survives re-renders (same as the old pattern in ActivityReport.tsx)
const issueCache = new Map<string, CacheEntry>();

function makeCacheKey(
  projectIdentifier: string, page: number,
  status: string, tracker: string, dateFrom: string, dateTo: string,
): string {
  return `${projectIdentifier}|${page}|${status}|${tracker}|${dateFrom}|${dateTo}`;
}

export interface IssueFilters {
  status: string;
  tracker: string;
  dateFrom: string;
  dateTo: string;
}

export interface UseRedmineIssuesReturn {
  issues: RedmineIssue[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  loading: boolean;
  lastFetchedKey: string;
  issueCache: typeof issueCache;
  filters: IssueFilters;
  setFilters: (f: IssueFilters) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  goToPage: (page: number) => void;
  refresh: () => void;
}

/**
 * Manages pagination, filtering, and the CACHE_TTL_MS caching logic for Redmine issues.
 * Extracted from ActivityReport.tsx.
 */
export function useRedmineIssues(projectIdentifier: string | null): UseRedmineIssuesReturn {
  const { toast } = useToast();

  const [issues, setIssues] = useState<RedmineIssue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [lastFetchedKey, setLastFetchedKey] = useState('');

  const [filters, setFilters] = useState<IssueFilters>({
    status: '', tracker: '', dateFrom: '', dateTo: '',
  });
  // Keep a ref for latest filters to pass directly without stale closure issues
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  const doFetch = useCallback(async (page: number, overrideFilters?: IssueFilters) => {
    if (!projectIdentifier) return;
    setLoading(true);
    const f = overrideFilters ?? filtersRef.current;
    const cacheKey = makeCacheKey(projectIdentifier, page, f.status, f.tracker, f.dateFrom, f.dateTo);
    const cached = issueCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setIssues(cached.issues);
      setTotalCount(cached.totalCount);
      setLastFetchedKey(cacheKey);
      setLoading(false);
      return;
    }
    try {
      const result = await fetchIssues({
        projectIdentifier,
        statusId: f.status || undefined,
        trackerId: f.tracker || undefined,
        dateFrom: f.dateFrom || undefined,
        dateTo: f.dateTo || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      issueCache.set(cacheKey, { issues: result.issues, totalCount: result.totalCount, ts: Date.now() });
      setIssues(result.issues);
      setTotalCount(result.totalCount);
      setLastFetchedKey(cacheKey);
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [projectIdentifier, toast]);

  // Initial fetch when identifier becomes available
  useEffect(() => {
    if (projectIdentifier) doFetch(1);
  }, [projectIdentifier]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = useCallback(() => {
    setCurrentPage(1);
    doFetch(1);
  }, [doFetch]);

  const resetFilters = useCallback(() => {
    const empty: IssueFilters = { status: '', tracker: '', dateFrom: '', dateTo: '' };
    setFilters(empty);
    setCurrentPage(1);
    doFetch(1, empty);
  }, [doFetch]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    doFetch(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [doFetch]);

  const refresh = useCallback(() => {
    if (!projectIdentifier) return;
    // Bust all cached entries for this identifier
    for (const key of issueCache.keys()) {
      if (key.startsWith(projectIdentifier)) issueCache.delete(key);
    }
    doFetch(currentPage);
  }, [projectIdentifier, currentPage, doFetch]);

  return {
    issues, totalCount, currentPage, totalPages: Math.ceil(totalCount / PAGE_SIZE),
    loading, lastFetchedKey, issueCache,
    filters, setFilters,
    applyFilters, resetFilters, goToPage, refresh,
  };
}
