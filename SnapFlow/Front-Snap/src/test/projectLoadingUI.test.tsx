import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectAudits from '@/pages/project/ProjectAudits';
import ProjectFiche from '@/pages/project/ProjectFiche';

const mocks = vi.hoisted(() => ({
  context: { projectId: 'project', project: { id: 'project', site_name: 'Local project', url: 'https://site.example', client_name: 'Local client', redmine_url: 'https://redmine.example/projects/project' }, setProjectLogoUrl: vi.fn() },
  fetchReport: vi.fn(), fetchDetail: vi.fn(), rows: [] as any[],
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useOutletContext: () => mocks.context }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user' }, isAdmin: true }) }));
vi.mock('@/hooks/useAuditSummaries', () => ({
  useAuditSummaries: () => ({ data: mocks.rows, isPending: false }),
  auditReportKey: (_user: string, row: any) => ['report', row.id, row.updated_at],
}));
vi.mock('@/services/auditListService', () => ({ fetchAuditReport: (...args: any[]) => mocks.fetchReport(...args) }));
vi.mock('@/services/redmineService', () => ({ fetchProjectDetail: (...args: any[]) => mocks.fetchDetail(...args) }));
vi.mock('@/hooks/useProjectAssignments', () => ({ useProjectAssignments: () => ({ assignedUser: null, loading: true }) }));
vi.mock('@/hooks/useRedmineIdentifier', () => ({ useRedmineIdentifier: () => 'project' }));
vi.mock('@/hooks/useAsyncAuditPoll', () => ({ useAsyncAuditPoll: () => ({ generating: false, setGenerating: vi.fn(), setPendingJob: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/projects/ClientLogoSidebar', () => ({ ClientLogoSidebar: () => null }));
vi.mock('@/components/projects/ProjectPerimeterEditor', () => ({ ProjectPerimeterEditor: () => null }));
vi.mock('@/components/projects/ProjectWorkflowSummary', () => ({ ProjectWorkflowSummary: () => null }));

const report = { siteName: 'Example', globalScore: 70, axes: [] };
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [1, 2, 3].map(id => ({ id: `${id}`, project_id: 'project', status: 'completed', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', archived_at: null, score: 70, axis_count: 9, has_report: true }));
  mocks.fetchDetail.mockReturnValue(new Promise(() => {}));
  mocks.fetchReport.mockResolvedValue(report);
});
afterEach(cleanup);

describe('project loading dependencies', () => {
  it('shows local project fields while Redmine is still waiting', () => {
    render(<ProjectFiche />, { wrapper });
    expect(screen.getByText('Local client')).toBeVisible();
    expect(screen.getByText('https://site.example')).toBeVisible();
    expect(mocks.fetchDetail).toHaveBeenCalledTimes(1);
  });

  it('does not fetch full reports until comparison, and then fetches only selected reports', async () => {
    render(<ProjectAudits />, { wrapper });
    expect(screen.getAllByText('70/100')).toHaveLength(3);
    expect(mocks.fetchReport).not.toHaveBeenCalled();
    // A real website URL needs no Redmine round trip to resolve its audit target.
    expect(mocks.fetchDetail).not.toHaveBeenCalled();
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(mocks.fetchReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Comparer (2)' }));
    await waitFor(() => expect(mocks.fetchReport).toHaveBeenCalledTimes(2));
    expect(mocks.fetchReport.mock.calls.map(call => call[0].id).sort()).toEqual(['1', '2']);
  });

  it('keeps a failed comparison visible as an error', async () => {
    mocks.fetchReport.mockRejectedValue(new Error('revision changed'));
    render(<ProjectAudits />, { wrapper });
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Comparer (2)' }));
    expect(await screen.findByText('Impossible de charger la comparaison. Actualiser')).toBeVisible();
  });
});
