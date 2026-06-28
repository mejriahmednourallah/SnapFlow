const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function scheduleTypeName(reportType: string): string {
  if (reportType === 'mystery_visit') return 'visite mystere';
  if (reportType === 'audit') return 'audit';
  return 'activite';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Fetch all active schedules that are due
    const now = new Date().toISOString();
    const { data: dueSchedules, error: fetchError } = await serviceClient
      .from('report_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', now);

    if (fetchError) {
      console.error('Failed to fetch schedules:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!dueSchedules || dueSchedules.length === 0) {
      console.log('No due schedules found.');
      return new Response(JSON.stringify({ executed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${dueSchedules.length} due schedule(s).`);
    const results: { id: string; status: string; error?: string }[] = [];

    for (const schedule of dueSchedules) {
      try {
        // Check end_date — deactivate if past
        if (schedule.end_date && new Date(schedule.end_date) < new Date()) {
          await serviceClient.from('report_schedules')
            .update({ is_active: false, updated_at: now })
            .eq('id', schedule.id);
          results.push({ id: schedule.id, status: 'deactivated_expired' });
          console.log(`Schedule ${schedule.id} expired, deactivated.`);
          continue;
        }

        if (schedule.report_type === 'audit') {
          await executeAudit(supabaseUrl, serviceClient, schedule);
        } else if (schedule.report_type === 'activity') {
          await executeActivity(supabaseUrl, anonKey, serviceClient, schedule);
        } else if (schedule.report_type === 'mystery_visit') {
          await executeAudit(supabaseUrl, serviceClient, schedule);
        } else {
          throw new Error(`Unsupported schedule type: ${schedule.report_type}`);
        }

        // Only update 'last_run_at' and compute 'next_normal_run' if we ARE NOT in the middle of a scan
        // Fetch current schedule state from DB to see if executeAudit just changed it
        const { data: updatedSchedule } = await serviceClient
          .from('report_schedules')
          .select('is_scanning, next_run_at')
          .eq('id', schedule.id)
          .single();

        if (updatedSchedule?.is_scanning) {
          results.push({ id: schedule.id, status: 'scanning_in_progress' });
          continue;
        }

        if (schedule.report_type === 'mystery_visit') {
          await serviceClient.from('report_schedules')
            .update({
              last_run_at: now,
              executed_at: now,
              is_active: false,
              updated_at: now,
            })
            .eq('id', schedule.id);
          results.push({ id: schedule.id, status: 'executed' });
          console.log(`Mystery visit schedule ${schedule.id} completed and deactivated.`);
          continue;
        }

        // If we reached here, either it was an activity report or the audit just finished.
        // Compute next_run_at for the normal cycle
        const nextRun = computeNextRun(
          schedule.frequency,
          schedule.next_run_at, 
          schedule.day_of_week,
          schedule.day_of_month
        );

        // Check if next run is beyond end_date
        const shouldDeactivate = schedule.end_date && new Date(nextRun) > new Date(schedule.end_date);

        await serviceClient.from('report_schedules')
          .update({
            last_run_at: now,
            next_run_at: nextRun,
            is_active: shouldDeactivate ? false : true,
            updated_at: now,
          })
          .eq('id', schedule.id);

        results.push({ id: schedule.id, status: 'executed' });
        console.log(`Schedule ${schedule.id} cycle completed. Next: ${nextRun}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`Schedule ${schedule.id} failed:`, msg);
        results.push({ id: schedule.id, status: 'error', error: msg });
      }
    }

    // Notify about executed reports
    for (const schedule of dueSchedules) {
      const result = results.find(r => r.id === schedule.id);
      if (result?.status === 'executed') {
        try {
          const { data: project } = await serviceClient
            .from('projects')
            .select('site_name')
            .eq('id', schedule.project_id)
            .single();

          const typeName = scheduleTypeName(schedule.report_type);
          await serviceClient.from('notifications').insert({
            user_id: schedule.created_by,
            title: 'Rapport planifié exécuté',
            message: `Le rapport ${typeName} planifié pour "${project?.site_name || '?'}" a été exécuté automatiquement.`,
            type: 'info',
            category: 'schedule',
          });
        } catch (notifErr) {
          console.error('Notification error (non-blocking):', notifErr);
        }
      }
    }

    return new Response(JSON.stringify({ executed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Execute scheduled reports error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function executeAudit(
  supabaseUrl: string,
  serviceClient: any,
  schedule: any
) {
  const now = new Date();
  
  // FETCH PROJECT URL
  const { data: project } = await serviceClient
    .from('projects')
    .select('url, site_name')
    .eq('id', schedule.project_id)
    .single();

  if (!project) throw new Error('Project not found');

  // STATE 1: INITIATE SCAN
  if (!schedule.is_scanning) {
    console.log(`[Schedule ${schedule.id}] Initiating new scan for ${project.site_name}`);
    
    // Call scanner via fetch-audit-api (internal fetch to avoid recursion issues)
    // Actually, we can just call the scanner directly since we have the URL and it's simpler
    const SCANNER_BASE = Deno.env.get('SCANNER_BASE_URL')?.trim();
    if (!SCANNER_BASE) throw new Error('SCANNER_BASE_URL not configured');

    const scanRes = await fetch(`${SCANNER_BASE}/scan`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Pinggy-No-Screen': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        url: project.url,
        max_pages: 100
      }),
    });

    if (!scanRes.ok) {
      const errorText = await scanRes.text();
      throw new Error(`Failed to initiate scan: ${scanRes.status} ${errorText}`);
    }

    const { scan_id } = await scanRes.json();
    if (!scan_id) throw new Error('Scanner return empty scan_id');

    // Create pending audit record
    const { data: audit, error: auditErr } = await serviceClient
      .from('audits')
      .insert({
        project_id: schedule.project_id,
        status: 'pending',
        job_id: scan_id // Map scanner ID to job_id
      })
      .select()
      .single();

    if (auditErr) throw auditErr;

    // Update schedule to 'scanning' state and set next run in 10 minutes
    const tenMinLater = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    await serviceClient.from('report_schedules')
      .update({
        is_scanning: true,
        current_scan_id: scan_id,
        next_run_at: tenMinLater,
        updated_at: now.toISOString()
      })
      .eq('id', schedule.id);

    console.log(`[Schedule ${schedule.id}] Scan started: ${scan_id}. Next check: ${tenMinLater}`);
    return;
  }

  // STATE 2: POLL STATUS
  if (schedule.is_scanning && schedule.current_scan_id) {
    console.log(`[Schedule ${schedule.id}] Checking status for scan: ${schedule.current_scan_id}`);
    
    const SCANNER_BASE = Deno.env.get('SCANNER_BASE_URL')?.trim();
    const statusRes = await fetch(`${SCANNER_BASE}/scan/${schedule.current_scan_id}/status`, {
      headers: { 
        'X-Pinggy-No-Screen': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!statusRes.ok) {
        console.warn(`[Schedule ${schedule.id}] Status check failed, will retry later.`);
        return; 
    }

    const statusData = await statusRes.json();
    const isFinished = statusData.status === 'done' || statusData.status === 'complete';

    if (isFinished) {
      console.log(`[Schedule ${schedule.id}] Scan complete. Fetching KPI payload...`);
      
      const fetchOpts = {
        headers: { 
          'X-Pinggy-No-Screen': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json'
        }
      };

      const kpisRes = await fetch(`${SCANNER_BASE}/scan/${schedule.current_scan_id}/kpis`, fetchOpts);
      const kpisPayload = kpisRes.ok ? await kpisRes.json() : null;

      if (!kpisPayload) throw new Error('Failed to fetch scan kpis payload');

      const reportPayload = {
        ...kpisPayload,
        scan_id: kpisPayload.scan_id ?? schedule.current_scan_id,
        generated_at: kpisPayload.generated_at ?? now.toISOString(),
      };

      // Update audit record
      await serviceClient.from('audits')
        .update({
          status: 'completed',
          report_data: reportPayload,
          updated_at: now.toISOString()
        })
        .eq('job_id', schedule.current_scan_id);

      // Reset schedule state and set normal next run based on frequency
      const nextRun = computeNextRun(
        schedule.frequency,
        schedule.next_run_at, // Use the current next_run (which was +10min)
        schedule.day_of_week,
        schedule.day_of_month
      );

      await serviceClient.from('report_schedules')
        .update({
          is_scanning: false,
          current_scan_id: null,
          last_run_at: now.toISOString(),
          next_run_at: nextRun,
          updated_at: now.toISOString()
        })
        .eq('id', schedule.id);

      console.log(`[Schedule ${schedule.id}] Finished. Reset to normal schedule. Next run: ${nextRun}`);
    } else if (statusData.status === 'failed') {
      console.error(`[Schedule ${schedule.id}] External scan failed.`);
      
      await serviceClient.from('audits')
        .update({ status: 'error', error_message: 'External scan failed' })
        .eq('job_id', schedule.current_scan_id);

      // Reset schedule
      await serviceClient.from('report_schedules')
        .update({
          is_scanning: false,
          current_scan_id: null,
          updated_at: now.toISOString()
        })
        .eq('id', schedule.id);
    } else {
      // Still processing: check again in 5 minutes
      const fiveMinLater = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      await serviceClient.from('report_schedules')
        .update({
          next_run_at: fiveMinLater,
          updated_at: now.toISOString()
        })
        .eq('id', schedule.id);
      console.log(`[Schedule ${schedule.id}] Scan still in progress. Retrying in 5 minutes.`);
    }
  }
}

async function executeActivity(
  supabaseUrl: string,
  anonKey: string,
  serviceClient: any,
  schedule: any
) {
  // Explicitly select url, redmine_url, site_name (following fetch-redmine pattern)
  const { data: project } = await serviceClient
    .from('projects')
    .select('id, site_name, url, redmine_url')
    .eq('id', schedule.project_id)
    .single();

  if (!project) throw new Error('Project not found');

  // Extract Redmine identifier from redmine_url (prioritize it, fall back to url for legacy projects)
  const redmineUrl = project.redmine_url || project.url || '';
  const match = redmineUrl.match(/\/projects\/([a-zA-Z0-9_-]+)/);
  const identifier = match ? match[1] : null;
  if (!identifier) throw new Error(`Cannot extract Redmine identifier from URL: ${redmineUrl}`);

  const issues: any[] = [];
  const seenIssueIds = new Set<number>();
  const requestedLimit = 500;
  let offset = 0;
  let totalCount = 0;

  for (let guard = 0; guard < 100; guard += 1) {
    const response = await fetch(`${supabaseUrl}/functions/v1/fetch-redmine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({
        type: 'issues',
        project_identifier: identifier,
        limit: requestedLimit,
        offset,
      }),
    });

    const data = await response.json();
    const pageIssues = data.issues || [];
    const receivedCount = pageIssues.length;
    totalCount = data.total_count || totalCount;

    const newIssues = pageIssues.filter((issue: any) => !seenIssueIds.has(issue.id));
    newIssues.forEach((issue: any) => seenIssueIds.add(issue.id));
    issues.push(...newIssues);

    if (receivedCount === 0 || newIssues.length === 0) break;
    if (totalCount > 0 && issues.length >= totalCount) break;

    // Redmine or the edge gateway can cap pages below the requested limit.
    // Move by the actual response size so scheduled reports are not capped at 100.
    offset += receivedCount;

    if (totalCount <= 0 && receivedCount < requestedLimit) break;
  }

  if (totalCount <= 0) totalCount = issues.length;

  // Save activity report
  const reportData = {
    issues,
    totalCount,
    generatedAt: new Date().toISOString(),
    projectName: project.site_name,
  };

  const { error: insertErr } = await serviceClient.from('activity_reports').insert({
    project_id: schedule.project_id,
    report_data: reportData,
    filters: {},
    ticket_count: issues.length,
  });

  if (insertErr) throw insertErr;
  console.log('Scheduled activity report saved for', project.site_name, `(${issues.length} issues)`);
}

function computeNextRun(
  frequency: string,
  currentNextRun: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null
): string {
  const base = new Date(currentNextRun);
  const now = new Date();
  // Always advance from current next_run or now, whichever is later
  const ref = base > now ? base : now;

  switch (frequency) {
    case 'once':
      return currentNextRun;
    case 'daily': {
      const next = new Date(ref);
      next.setDate(next.getDate() + 1);
      next.setHours(base.getHours(), base.getMinutes(), 0, 0);
      return next.toISOString();
    }
    case 'weekly': {
      const next = new Date(ref);
      next.setDate(next.getDate() + 7);
      next.setHours(base.getHours(), base.getMinutes(), 0, 0);
      return next.toISOString();
    }
    case 'biweekly': {
      const next = new Date(ref);
      next.setDate(next.getDate() + 14);
      next.setHours(base.getHours(), base.getMinutes(), 0, 0);
      return next.toISOString();
    }
    case 'monthly': {
      const next = new Date(ref);
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth) next.setDate(dayOfMonth);
      next.setHours(base.getHours(), base.getMinutes(), 0, 0);
      return next.toISOString();
    }
    default:
      return new Date(ref.getTime() + 86400000).toISOString();
  }
}
