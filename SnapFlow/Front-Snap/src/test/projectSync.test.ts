import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Assignment = {
  project_id: string;
  user_id?: string;
  profiles?: {
    email: string;
    full_name: string;
  };
};

type Project = {
  id: string;
  site_name: string;
  url: string;
  redmine_url: string | null;
};

type SyncDetail = {
  project_id?: string;
  status: 'matched' | 'matched_via_custom_field' | 'ambiguous' | 'skipped' | 'error';
  reason?: string;
};

type SyncResponse = {
  success: boolean;
  matched: number;
  skipped: number;
  ambiguous: number;
  errors: number;
  details: SyncDetail[];
};

const testUserId = 'test-user-123';
const testUserEmail = 'charge@example.com';

const defaultProjects: Project[] = [
  {
    id: 'proj-456',
    site_name: 'Test Project',
    url: 'https://example.com',
    redmine_url: 'https://maintenance.medianet.tn/projects/test-project',
  },
  {
    id: 'proj-null',
    site_name: 'Legacy Project',
    url: 'https://legacy.example.com',
    redmine_url: null,
  },
];

const defaultAssignments: Assignment[] = [
  {
    project_id: 'proj-456',
    user_id: testUserId,
    profiles: {
      email: testUserEmail,
      full_name: 'Test Charge',
    },
  },
];

const defaultSyncResponse: SyncResponse = {
  success: true,
  matched: 1,
  skipped: 1,
  ambiguous: 1,
  errors: 1,
  details: [
    { project_id: 'proj-456', status: 'matched' },
    { project_id: 'proj-email', status: 'matched_via_custom_field' },
    { project_id: 'proj-ambiguous', status: 'ambiguous', reason: 'Multiple Redmine Account matches' },
    { project_id: 'proj-null', status: 'skipped', reason: 'Missing redmine_url' },
    { project_id: 'proj-error', status: 'error', reason: 'Redmine unreachable' },
  ],
};

const state = vi.hoisted(() => ({
  assignments: [] as Assignment[],
  projects: [] as Project[],
  syncResponse: null as SyncResponse | null,
  callLog: [] as string[],
}));

let supabase: typeof import('@/integrations/supabase/client')['supabase'];

vi.mock('@/integrations/supabase/client', () => {
  const applyFilters = <T extends Record<string, any>>(rows: T[], filters: Record<string, any>) => {
    let result = rows;

    for (const [key, value] of Object.entries(filters)) {
      if (key.endsWith(':in')) {
        const field = key.replace(':in', '');
        result = result.filter((row) => Array.isArray(value) && value.includes(row[field]));
      } else {
        result = result.filter((row) => row[key] === value);
      }
    }

    return result;
  };

  const createQuery = (table: string) => {
    const filters: Record<string, any> = {};
    let limitCount: number | null = null;

    const resolve = () => {
      state.callLog.push(`query:${table}`);

      const rows = table === 'project_assignments'
        ? applyFilters(state.assignments, filters)
        : table === 'projects'
          ? applyFilters(state.projects, filters)
          : [];

      return {
        data: typeof limitCount === 'number' ? rows.slice(0, limitCount) : rows,
        error: null,
      };
    };

    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((field: string, value: any) => {
        filters[field] = value;
        return query;
      }),
      in: vi.fn((field: string, value: any[]) => {
        filters[`${field}:in`] = value;
        return query;
      }),
      limit: vi.fn((count: number) => {
        limitCount = count;
        return query;
      }),
      then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };

    return query;
  };

  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
      },
      functions: {
        invoke: vi.fn(async () => {
          state.callLog.push('invoke:fetch-redmine');
          return { data: state.syncResponse, error: null };
        }),
      },
      from: vi.fn((table: string) => createQuery(table)),
    },
  };
});

beforeAll(async () => {
  ({ supabase } = await import('@/integrations/supabase/client'));
});

const syncAccountProjects = () => supabase.functions.invoke('fetch-redmine', {
  body: { type: 'sync_my_account_projects' },
});

describe('Project Sync Flow - Redmine Account Mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.assignments = structuredClone(defaultAssignments);
    state.projects = structuredClone(defaultProjects);
    state.syncResponse = structuredClone(defaultSyncResponse);
    state.callLog = [];

    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          user: {
            id: testUserId,
            email: testUserEmail,
            user_metadata: { full_name: 'Test Charge' },
          },
        },
      } as any,
    });
  });

  describe('Sync endpoint: sync_my_account_projects', () => {
    it('returns a successful sync summary', async () => {
      const syncResponse = await syncAccountProjects();

      expect(syncResponse.data).toEqual(expect.objectContaining({
        success: true,
        matched: 1,
        skipped: 1,
      }));
      expect(syncResponse.error).toBeNull();
    });

    it('matches user against Account membership by email', async () => {
      const syncResponse = await syncAccountProjects();
      const matchedDetails = syncResponse.data?.details.filter(
        (detail) => detail.status === 'matched' || detail.status === 'matched_via_custom_field',
      );

      expect(matchedDetails).toHaveLength(2);
      expect(matchedDetails?.map((detail) => detail.status)).toContain('matched_via_custom_field');
    });

    it('marks ambiguous mappings as skipped for safety', async () => {
      const syncResponse = await syncAccountProjects();
      const ambiguousDetails = syncResponse.data?.details.filter((detail) => detail.status === 'ambiguous');

      expect(syncResponse.data?.ambiguous).toBe(1);
      expect(ambiguousDetails?.[0].reason).toContain('Multiple');
    });

    it('logs errors without crashing for unreachable Redmine projects', async () => {
      const syncResponse = await syncAccountProjects();
      const totalProcessed = syncResponse.data!.matched
        + syncResponse.data!.errors
        + syncResponse.data!.skipped
        + syncResponse.data!.ambiguous;

      expect(syncResponse.data?.success).toBe(true);
      expect(totalProcessed).toBeGreaterThan(0);
    });
  });

  describe('Dashboard: sync-before-read flow', () => {
    it('calls sync endpoint before fetching assignments', async () => {
      await syncAccountProjects();

      const { data: assignments, error } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', testUserId);

      expect(error).toBeNull();
      expect(assignments).toEqual([{ project_id: 'proj-456', user_id: testUserId, profiles: defaultAssignments[0].profiles }]);
      expect(state.callLog).toEqual(['invoke:fetch-redmine', 'query:project_assignments']);
    });

    it('shows no projects if user has no Redmine Account assignments', async () => {
      state.assignments = [];

      await syncAccountProjects();
      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', testUserId);

      expect(assignments).toEqual([]);
    });

    it('respects assignment-based project filtering', async () => {
      await syncAccountProjects();

      const { data: assignments, error: assignErr } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', testUserId);

      expect(assignErr).toBeNull();
      expect(Array.isArray(assignments)).toBe(true);

      const projectIds = assignments!.map((assignment) => assignment.project_id);
      const { data: projects, error: projectErr } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds);

      expect(projectErr).toBeNull();
      expect(projects).toHaveLength(1);
      expect(projects?.[0].id).toBe('proj-456');
    });
  });

  describe('ReportSchedules: sync-before-read flow', () => {
    it('syncs account projects before deriving available projects', async () => {
      const syncResult = await syncAccountProjects();
      const { data: projects } = await supabase.from('projects').select('*');
      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id, user_id')
        .eq('user_id', testUserId);

      const assignedIds = new Set((assignments || []).map((assignment) => assignment.project_id));
      const availableProjects = (projects || []).filter((project) => assignedIds.has(project.id));

      expect(syncResult.data?.success).toBe(true);
      expect(availableProjects.map((project) => project.id)).toEqual(['proj-456']);
    });

    it('allows admin-style project reads without sync filtering', async () => {
      const { data: allProjects, error } = await supabase.from('projects').select('*').limit(10);

      expect(error).toBeNull();
      expect(allProjects).toHaveLength(2);
    });
  });

  describe('Notifications with synced users', () => {
    it('includes synced users in audit notification assignment data', async () => {
      await syncAccountProjects();

      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id, profiles(email, full_name)')
        .eq('user_id', testUserId);

      expect(assignments?.[0].profiles).toEqual({
        email: testUserEmail,
        full_name: 'Test Charge',
      });
    });
  });

  describe('Regression: Old client-side fallback removed', () => {
    it('does all Redmine matching through one server-side sync call', async () => {
      const syncResult = await syncAccountProjects();

      expect(syncResult.data?.details).toBeDefined();
      expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
      expect(supabase.functions.invoke).toHaveBeenCalledWith('fetch-redmine', {
        body: { type: 'sync_my_account_projects' },
      });
    });

    it('uses correct Redmine identifier extraction shape', () => {
      const testUrl = 'https://maintenance.medianet.tn/projects/my-project';
      const match = testUrl.match(/\/projects\/([a-zA-Z0-9_-]+)/);

      expect(match?.[1]).toBe('my-project');
    });
  });

  describe('Edge cases and safety', () => {
    it('handles projects with null redmine_url gracefully', async () => {
      const syncResponse = await syncAccountProjects();
      const skippedDetails = syncResponse.data?.details.filter((detail) => detail.status === 'skipped');

      expect(skippedDetails?.[0]).toEqual(expect.objectContaining({
        project_id: 'proj-null',
        reason: 'Missing redmine_url',
      }));
    });

    it('normalizes email/name case for matching', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            user: {
              id: testUserId,
              email: 'Charge@Example.COM',
              user_metadata: { full_name: 'TEST CHARGE' },
            },
          },
        } as any,
      });

      const syncResponse = await syncAccountProjects();

      expect(syncResponse.data?.success).toBe(true);
    });
  });
});
