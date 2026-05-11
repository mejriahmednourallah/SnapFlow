import { supabase } from '@/integrations/supabase/client';
import { mapApiResponseToReport, type ApiResponse } from '@/lib/auditMapper';
import type { AuditReport } from '@/data/mockAuditData';

export interface PendingJob {
  auditId: string;
  jobId: string;
}

export interface ProjectRef {
  id: string;
  site_name: string;
  url: string;
}

function normalizeAuditUrl(projectUrl: string): string {
  const raw = projectUrl.trim();
  if (!raw) return raw;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol;
}

/** Insert a new "generating" audit row and kick off the async audit job.
 *  Returns the newly created auditId and the job_id from the backend.
 */
export async function generateAudit(projectId: string, projectUrl: string): Promise<PendingJob> {
  const auditUrl = normalizeAuditUrl(projectUrl);
  console.log(`[generateAudit] projectId=${projectId}, original=${projectUrl}, normalized=${auditUrl}`);

  // Step 1 — create audit row
  const { data: auditRow, error: insertErr } = await supabase
    .from('audits')
    .insert({ project_id: projectId, status: 'generating' })
    .select('id')
    .single();
  if (insertErr) throw insertErr;
  const auditId: string = auditRow.id;

  try {
    // Step 2 — fire async job with the normalized URL
    console.log(`[generateAudit] Invoking fetch-audit-api with URL: ${auditUrl}`);
    const { data: startData, error: fnErr } = await supabase.functions.invoke('fetch-audit-api', {
      body: { url: auditUrl, async_mode: true },
    });
    if (fnErr) {
      console.error(`[generateAudit] Edge Function error: ${fnErr.message}`);
      throw fnErr;
    }
    if (startData?.error) {
      console.error(`[generateAudit] API returned error: ${startData.error}`);
      throw new Error(startData.error);
    }
    if (!startData?.job_id) {
      console.error(`[generateAudit] No job_id returned from API`);
      throw new Error(`Le backend n'a pas retourné de job_id`);
    }
    console.log(`[generateAudit] Job started with ID: ${startData.job_id}`);

    // Step 3 — persist job_id
    await supabase
      .from('audits')
      .update({ job_id: startData.job_id } as any)
      .eq('id', auditId);

    return { auditId, jobId: startData.job_id };
  } catch (error) {
    // If Edge Function fails, mark the audit as failed to unlock the UI
    console.error(`[generateAudit] Marking audit ${auditId} as failed due to error:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await supabase
      .from('audits')
      .update({ status: 'error', notes: `Erreur au démarrage: ${errorMessage}` } as any)
      .eq('id', auditId)
      .catch(dbErr => console.error('[generateAudit] Failed to mark audit as error:', dbErr));
    
    // Re-throw the original error so it propagates to the UI
    throw error;
  }
}

/** Poll an async audit job by job_id.
 *  Returns the current status string ('pending' | 'running' | 'done' | 'error')
 *  and any result/error payload.
 */
export async function pollAuditJob(jobId: string): Promise<{ status: string; result?: ApiResponse; error?: string }> {
  const { data, error: fnErr } = await supabase.functions.invoke('poll-audit-job', {
    body: { job_id: jobId },
  });
  if (fnErr) return { status: 'error', error: fnErr.message };
  if (data?.error) return { status: 'error', error: data.error };
  return {
    status: data?.status ?? 'error',
    result: data?.result,
    error: data?.error,
  };
}

/** Mark an audit row as completed with the mapped report payload. */
export async function completeAuditRow(
  auditId: string,
  rawResult: ApiResponse,
  project: ProjectRef,
  userId: string,
): Promise<number> {
  const reportData = mapApiResponseToReport(rawResult, auditId, project);

  const { error: updateErr } = await supabase
    .from('audits')
    .update({ status: 'completed', report_data: reportData as unknown as any, updated_at: new Date().toISOString() })
    .eq('id', auditId);
  if (updateErr) throw updateErr;

  // Fire notification
  await supabase.from('notifications').insert({
    user_id: userId,
    title: 'Audit terminé',
    message: `Le rapport d'audit pour "${project.site_name}" a été généré avec succès — Score : ${reportData.globalScore}/100.`,
    type: 'success',
    category: 'audit',
    reference_id: auditId,
    reference_type: 'audit',
  });

  return reportData.globalScore;
}

/** Mark an audit row as failed. */
export async function failAuditRow(auditId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('audits')
    .update({ status: 'error', error_message: errorMessage, updated_at: new Date().toISOString() })
    .eq('id', auditId);
}

/** Archive an audit row. */
export async function archiveAudit(auditId: string): Promise<void> {
  const { error } = await supabase
    .from('audits')
    .update({ archived_at: new Date().toISOString() } as any)
    .eq('id', auditId);
  if (error) throw error;
}

/** Permanently delete an audit row. */
export async function deleteAudit(auditId: string): Promise<void> {
  const { error } = await supabase.from('audits').delete().eq('id', auditId);
  if (error) throw error;
}

/** Persist manual report edits for an existing audit row. */
export async function updateAuditReportData(auditId: string, reportData: AuditReport): Promise<void> {
  const { error } = await supabase
    .from('audits')
    .update({
      report_data: reportData as unknown as any,
      updated_at: new Date().toISOString(),
    })
    .eq('id', auditId);

  if (error) throw error;
}
