import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type AuditListRow = Database['public']['Functions']['get_audit_list']['Returns'][number];
export type AuditListOptions = { projectId?: string; latestPerProject?: boolean; completedOnly?: boolean };

export async function fetchAuditList(options: AuditListOptions, signal?: AbortSignal): Promise<AuditListRow[]> {
  const rows: AuditListRow[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    let request = supabase.rpc('get_audit_list', {
      p_project_id: options.projectId,
      p_latest_per_project: options.latestPerProject ?? false,
      p_completed_only: options.completedOnly ?? false,
    }).range(offset, offset + pageSize - 1);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function fetchAuditReport(row: AuditListRow, signal?: AbortSignal) {
  let request = supabase.from('audits').select('report_data')
    .eq('id', row.id).eq('updated_at', row.updated_at);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Ce rapport a changé. Actualisez la liste.');
  return data.report_data;
}
