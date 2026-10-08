import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProjectAccountData } from '../../supabase/functions/_shared/redmineProjectRequests';
import { fetchProjectDetail } from '@/services/redmineService';
import { fetchAuditList, fetchAuditReport } from '@/services/auditListService';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mocks.invoke }, rpc: mocks.rpc, from: mocks.from,
} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe('live Redmine project reads', () => {
  it('shares overlapping requests per user, but refetches after completion', async () => {
    const response = deferred<any>();
    mocks.invoke.mockReturnValueOnce(response.promise);
    const first = fetchProjectDetail('same-project', 'user-one');
    const second = fetchProjectDetail('same-project', 'user-one');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    response.resolve({ data: { project: { homepage: 'https://example.com' } }, error: null });
    expect(await first).toEqual(await second);
    mocks.invoke.mockResolvedValue({ data: { project: { homepage: 'https://updated.example.com' } } });
    expect((await fetchProjectDetail('same-project', 'user-one'))?.homepage).toContain('updated');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('isolates users and permits retry after a failed request', async () => {
    mocks.invoke.mockResolvedValue({ error: new Error('provider unavailable') });
    const requests = [fetchProjectDetail('same-project', 'user-a'), fetchProjectDetail('same-project', 'user-b')];
    await Promise.all(requests.map(request => expect(request).rejects.toThrow('provider unavailable')));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    mocks.invoke.mockResolvedValue({ data: { project: { id: 1 } } });
    await fetchProjectDetail('same-project', 'user-a');
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });

  it('starts membership lookup before the project responds without fetching it twice', async () => {
    const project = deferred<{ project: { id: number } }>();
    const loadProject = vi.fn();
    const loadMembers = vi.fn().mockResolvedValue({ memberships: ['account'] });
    const result = loadProjectAccountData(loadProject, loadMembers, project.promise);
    expect(loadMembers).toHaveBeenCalledTimes(1);
    expect(loadProject).not.toHaveBeenCalled();
    project.resolve({ project: { id: 7 } });
    expect(await result).toEqual([{ project: { id: 7 } }, { memberships: ['account'] }]);
  });
});

describe('compact audit requests', () => {
  it('paginates beyond the REST row cap and propagates options', async () => {
    const range = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, id) => ({ id })) })
      .mockResolvedValueOnce({ data: [{ id: 201 }] });
    mocks.rpc.mockReturnValue({ range });
    expect(await fetchAuditList({ projectId: 'project', latestPerProject: true })).toHaveLength(201);
    expect(range.mock.calls).toEqual([[0, 199], [200, 399]]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_audit_list', {
      p_project_id: 'project', p_latest_per_project: true, p_completed_only: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reports database failures rather than an empty list', async () => {
    mocks.rpc.mockReturnValue({ range: () => Promise.resolve({ error: new Error('database failed') }) });
    await expect(fetchAuditList({})).rejects.toThrow('database failed');
  });

  it('loads only the chosen report revision and rejects stale metadata', async () => {
    const builder: any = {};
    for (const method of ['select', 'eq', 'abortSignal']) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null });
    mocks.from.mockReturnValue(builder);
    await expect(fetchAuditReport({ id: 'selected', updated_at: 'revision-one' } as any)).rejects.toThrow('a changé');
    expect(builder.select).toHaveBeenCalledWith('report_data');
    expect(builder.eq.mock.calls).toEqual([['id', 'selected'], ['updated_at', 'revision-one']]);
  });
});
