import { supabase } from '@/integrations/supabase/client';
import type { RedmineIssue } from './redmineService';

export interface SavedActivityReport {
  id: string;
  created_at: string;
  archived_at: string | null;
  filters: Record<string, string>;
  report_data: {
    issues: RedmineIssue[];
    totalCount: number;
    generatedAt: string;
    projectName?: string;
  };
  ticket_count: number;
}

export interface SaveSnapshotParams {
  projectId: string;
  issues: RedmineIssue[];
  totalCount: number;
  projectName?: string;
  filters: {
    filterStatus: string;
    filterTracker: string;
    filterDateFrom: string;
    filterDateTo: string;
  };
}

/** Save a snapshot of current issues as an activity report. */
export async function saveActivitySnapshot(params: SaveSnapshotParams): Promise<void> {
  const reportData = {
    issues: params.issues,
    totalCount: params.totalCount,
    generatedAt: new Date().toISOString(),
    projectName: params.projectName,
  };
  const { error } = await supabase.from('activity_reports').insert({
    project_id: params.projectId,
    report_data: reportData,
    filters: params.filters,
    ticket_count: params.issues.length,
  } as any);
  if (error) throw error;
}

/** Fetch all activity reports for a project ordered by creation date. */
export async function fetchActivityReports(projectId: string): Promise<SavedActivityReport[]> {
  const { data, error } = await supabase
    .from('activity_reports')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SavedActivityReport[]) || [];
}

/** Archive a saved activity report. */
export async function archiveActivityReport(reportId: string): Promise<void> {
  const { error } = await supabase
    .from('activity_reports')
    .update({ archived_at: new Date().toISOString() } as any)
    .eq('id', reportId);
  if (error) throw error;
}
