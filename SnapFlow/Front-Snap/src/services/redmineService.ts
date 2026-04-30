import { supabase } from '@/integrations/supabase/client';

export interface RedmineIssue {
  id: number;
  subject: string;
  description?: string;
  status: { id: number; name: string };
  tracker: { id: number; name: string };
  priority: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  author: { id: number; name: string };
  created_on: string;
  updated_on: string;
  done_ratio: number;
  estimated_hours?: number;
  spent_hours?: number;
}

export interface FilterOption {
  id: number;
  name: string;
}

export interface RedmineUser {
  id: number;
  name: string;
  mail?: string;
  firstname?: string;
  lastname?: string;
}

export interface RedmineProjectDetail {
  description?: string;
  created_on?: string;
  updated_on?: string;
  homepage?: string;
  custom_fields?: { id: number; name: string; value: string }[];
  memberships?: { id: number; user?: { id: number; name: string }; roles: { id: number; name: string }[] }[];
}

export interface FetchIssuesParams {
  projectIdentifier: string;
  statusId?: string;
  trackerId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface FetchIssuesResult {
  issues: RedmineIssue[];
  totalCount: number;
}

type CreateRedmineIssueResponse = {
  issue?: { id: number };
  success?: boolean;
  error?: string;
  details?: { errors?: string[] } | unknown;
  response_preview?: string;
  redmine_status?: number;
};

function previewText(value: unknown, maxLength = 300): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Fetch a paginated list of Redmine issues for a project. */
export async function fetchIssues(params: FetchIssuesParams): Promise<FetchIssuesResult> {
  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: {
      type: 'issues',
      project_identifier: params.projectIdentifier,
      status_id: params.statusId || undefined,
      tracker_id: params.trackerId || undefined,
      created_on_from: params.dateFrom || undefined,
      created_on_to: params.dateTo || undefined,
      limit: params.limit ?? 25,
      offset: params.offset ?? 0,
    },
  });
  if (error) throw error;
  return { issues: data.issues || [], totalCount: data.total_count || 0 };
}

/** Fetch Redmine issue statuses and trackers. */
export async function fetchIssueFilters(): Promise<{ statuses: FilterOption[]; trackers: FilterOption[] }> {
  const [statusRes, trackerRes] = await Promise.all([
    supabase.functions.invoke('fetch-redmine', { body: { type: 'issue_statuses' } }),
    supabase.functions.invoke('fetch-redmine', { body: { type: 'trackers' } }),
  ]);
  return {
    statuses: statusRes.data?.issue_statuses || [],
    trackers: trackerRes.data?.trackers || [],
  };
}

/** Fetch detailed project information from Redmine. */
export async function fetchProjectDetail(projectIdentifier: string): Promise<RedmineProjectDetail | null> {
  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: { type: 'project_detail', project_identifier: projectIdentifier },
  });
  if (error) return null;
  return data?.project || null;
}

/** Fetch all Redmine users. */
export async function fetchRedmineUsers(): Promise<RedmineUser[]> {
  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: { type: 'users' },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.users || [];
}

/** Search issues by subject/title in a Redmine project. */
export async function searchIssues(projectIdentifier: string, subject: string): Promise<RedmineIssue[]> {
  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: { type: 'search_issues', project_identifier: projectIdentifier, subject },
  });
  if (error) throw error;
  return data?.issues || [];
}

/** Create a Redmine issue. */
export async function createRedmineIssue(params: {
  projectIdentifier: string;
  subject: string;
  description: string;
  assignedToId?: number;
}): Promise<CreateRedmineIssueResponse> {
  console.info('[redmineService][createRedmineIssue] request', {
    projectIdentifier: params.projectIdentifier,
    subject: params.subject,
    descriptionLength: params.description?.length ?? 0,
    assignedToId: params.assignedToId ?? null,
  });

  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: {
      type: 'create_issue',
      project_identifier: params.projectIdentifier,
      subject: params.subject,
      description: params.description,
      assigned_to_id: params.assignedToId || undefined,
    },
  });

  console.info('[redmineService][createRedmineIssue] response', {
    hasTransportError: Boolean(error),
    transportErrorMessage: error?.message ?? null,
    redmineStatus: data?.redmine_status ?? null,
    success: data?.success ?? null,
    edgeError: data?.error ?? null,
    issueId: data?.issue?.id ?? null,
    responsePreview: previewText(data?.response_preview ?? data?.details ?? null),
  });

  if (error) {
    throw error;
  }

  if (data?.error) {
    const rawDetails = data.response_preview ?? data.details ?? null;
    const detailText = previewText(rawDetails);
    const detailsPreview = detailText ? ` | ${detailText}` : '';
    throw new Error(`${data.error}${detailsPreview}`);
  }

  return data as CreateRedmineIssueResponse;
}

/** Sync Redmine homepages to project URLs. */
export async function syncRedmineHomepages(): Promise<{ updated: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('fetch-redmine', {
    body: { type: 'sync_homepages' },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { updated: data.updated, total: data.total };
}

/** Extract the Redmine project identifier slug from a URL. */
export function extractRedmineIdentifier(url: string): string | null {
  const match = url?.match(/\/projects\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
