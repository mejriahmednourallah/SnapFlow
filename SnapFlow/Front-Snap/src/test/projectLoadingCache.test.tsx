import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuditSummaries } from '@/hooks/useAuditSummaries';
import { useProjectDataChanges } from '@/hooks/useProjectDataChanges';
import { queryClient } from '@/lib/queryClient';

const mocks = vi.hoisted(() => ({ list: vi.fn(), report: vi.fn(), subscribe: null as any, changes: [] as any[], remove: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user' }, userRole: 'admin' }) }));
vi.mock('@/services/auditListService', () => ({ fetchAuditList: (...args: any[]) => mocks.list(...args), fetchAuditReport: (...args: any[]) => mocks.report(...args) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  channel: () => {
    const channel: any = {};
    channel.on = (_event: string, _filter: any, callback: any) => { mocks.changes.push(callback); return channel; };
    channel.subscribe = (callback: any) => { mocks.subscribe = callback; return channel; };
    return channel;
  }, removeChannel: (...args: any[]) => mocks.remove(...args),
} }));
const row = { id: 'audit', updated_at: 'revision', score: 70, axis_count: 9, requires_report: false, site_name: 'Site', url: 'https://example.com' };
let client: QueryClient;
let wrapper: ({ children }: { children: React.ReactNode }) => React.ReactNode;
beforeEach(() => {
  vi.clearAllMocks(); mocks.changes = [];
  mocks.list.mockResolvedValue([row]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('project query reuse and freshness', () => {
  it('reuses a fresh visit and refreshes changed scores after invalidation', async () => {
    const first = renderHook(() => useAuditSummaries(), { wrapper });
    await waitFor(() => expect(first.result.current.data[0]?.score).toBe(70));
    first.unmount();
    const second = renderHook(() => useAuditSummaries(), { wrapper });
    expect(second.result.current.data[0]?.score).toBe(70);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    mocks.list.mockResolvedValue([{ ...row, score: 80 }]);
    await act(() => client.invalidateQueries({ queryKey: ['audit-list','user'] }));
    await waitFor(() => expect(second.result.current.data[0]?.score).toBe(80));
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('exposes legacy metadata while its exact score is still being fetched', async () => {
    let resolve!: (value: any) => void;
    mocks.list.mockResolvedValue([{ ...row, requires_report: true, score: null, axis_count: null }]);
    mocks.report.mockReturnValue(new Promise(done => { resolve = done; }));
    const hook = renderHook(() => useAuditSummaries(), { wrapper });
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    expect(hook.result.current.isPending).toBe(false);
    expect(hook.result.current.scoresLoading).toBe(true);
    await act(async () => resolve({ siteName: 'Site', globalScore: 55, axes: [] }));
    await waitFor(() => expect(hook.result.current.data[0].score).toBe(55));
    expect(hook.result.current.data[0].requires_report).toBe(false);
  });

  it('coalesces realtime changes and refreshes on reconnect without repeating initial reads', async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const hook = renderHook(() => useProjectDataChanges());
    act(() => mocks.subscribe('SUBSCRIBED'));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => { mocks.changes[0](); mocks.changes[1](); mocks.changes[2](); });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(invalidate).toHaveBeenCalledTimes(6);
    invalidate.mockClear();
    act(() => mocks.subscribe('SUBSCRIBED'));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(invalidate).toHaveBeenCalledTimes(6);
    act(() => mocks.changes[0]());
    hook.unmount();
    invalidate.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale metadata before retrying a legacy report', async () => {
    mocks.list.mockResolvedValue([{ ...row, requires_report: true, score: null }]);
    mocks.report.mockRejectedValueOnce(new Error('report changed'))
      .mockResolvedValue({ siteName: 'Site', globalScore: 81, axes: [] });
    const hook = renderHook(() => useAuditSummaries(), { wrapper });
    await waitFor(() => expect(hook.result.current.scoreError).toBeTruthy());
    mocks.list.mockResolvedValue([{ ...row, updated_at: 'new-revision', requires_report: true, score: null }]);
    await act(async () => { await hook.result.current.refetchScores(); });
    await waitFor(() => expect(hook.result.current.data[0].score).toBe(81));
    expect(mocks.report.mock.calls.map(call => call[0].updated_at)).toEqual(['revision','new-revision']);
  });
});
