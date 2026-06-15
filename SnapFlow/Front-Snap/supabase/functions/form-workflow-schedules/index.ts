// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  readJsonBody,
  toJson,
} from '../_shared/formTester.ts';

interface ScheduleBody {
  action?: 'list' | 'create' | 'update' | 'delete' | 'run_now' | 'refresh_snapshot';
  schedule_id?: string;
  workflow_id?: string;
  scenario_id?: string;
  name?: string;
  frequency?: 'once' | 'daily' | 'weekly' | 'monthly';
  timezone?: string;
  start_at?: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  end_at?: string | null;
  environment?: string;
  is_active?: boolean;
}

async function isAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });
  if (error) throw new HttpError(500, error.message);
  return Boolean(data);
}

async function getWorkflow(serviceClient, workflowId: string) {
  const { data, error } = await serviceClient
    .from('form_workflows')
    .select('*')
    .eq('id', workflowId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Workflow introuvable');
  return data;
}

async function getSchedule(serviceClient, scheduleId: string) {
  const { data, error } = await serviceClient
    .from('workflow_schedules')
    .select('*, form_scenario_versions(version_number, checksum)')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Planification introuvable');
  return data;
}

function canManage(row: { created_by: string; org_id: string }, userId: string, admin: boolean): boolean {
  return admin || row.created_by === userId || row.org_id === userId;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const admin = await isAdmin(serviceClient, userId);
    const body = await readJsonBody<ScheduleBody>(req);
    const action = body.action ?? 'list';

    if (action === 'list') {
      let query = serviceClient
        .from('workflow_schedules')
        .select('*, form_scenario_versions(version_number, checksum), form_workflows(name, target_url)')
        .order('next_run_at', { ascending: true, nullsFirst: false });
      if (body.workflow_id) query = query.eq('workflow_id', body.workflow_id);
      if (!admin) query = query.or(`created_by.eq.${userId},org_id.eq.${userId}`);
      const { data: schedules, error } = await query;
      if (error) throw new HttpError(500, error.message);

      const scheduleIds = (schedules ?? []).map((item) => item.id);
      let runs = [];
      if (scheduleIds.length > 0) {
        const { data, error: runsError } = await serviceClient
          .from('workflow_schedule_runs')
          .select('*')
          .in('schedule_id', scheduleIds)
          .order('scheduled_for', { ascending: false })
          .limit(100);
        if (runsError) throw new HttpError(500, runsError.message);
        runs = data ?? [];
      }
      return toJson({ schedules: schedules ?? [], runs });
    }

    if (action === 'create') {
      if (!body.workflow_id || !body.scenario_id || !body.frequency || !body.start_at) {
        throw new HttpError(400, 'workflow_id, scenario_id, frequency et start_at sont requis');
      }
      const workflow = await getWorkflow(serviceClient, body.workflow_id);
      if (!canManage(workflow, userId, admin)) throw new HttpError(403, 'Acces refuse');

      const { data: schedule, error } = await serviceClient.rpc('form_test_create_schedule', {
        p_workflow_id: body.workflow_id,
        p_scenario_id: body.scenario_id,
        p_created_by: userId,
        p_name: body.name?.trim() || `${workflow.name} - planification`,
        p_frequency: body.frequency,
        p_timezone: body.timezone?.trim() || 'Europe/Paris',
        p_start_at: body.start_at,
        p_day_of_week: body.frequency === 'weekly' ? body.day_of_week ?? null : null,
        p_day_of_month: body.frequency === 'monthly' ? body.day_of_month ?? null : null,
        p_end_at: body.end_at || null,
        p_environment: body.environment?.trim() || 'default',
      });
      if (error) throw new HttpError(400, error.message);
      return toJson({ schedule }, 201);
    }

    if (!body.schedule_id) throw new HttpError(400, 'schedule_id requis');
    const schedule = await getSchedule(serviceClient, body.schedule_id);
    if (!canManage(schedule, userId, admin)) throw new HttpError(403, 'Acces refuse');

    if (action === 'delete') {
      const { error } = await serviceClient.from('workflow_schedules').delete().eq('id', schedule.id);
      if (error) throw new HttpError(500, error.message);
      return toJson({ success: true });
    }

    if (action === 'run_now') {
      const cutoff = new Date(Date.now() - 30_000).toISOString();
      const { data: recentRun, error: recentError } = await serviceClient
        .from('workflow_schedule_runs')
        .select('id, execution_id, scheduled_for')
        .eq('schedule_id', schedule.id)
        .gte('scheduled_for', cutoff)
        .order('scheduled_for', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentError) throw new HttpError(500, recentError.message);
      if (recentRun) return toJson({ run: recentRun, duplicate_prevented: true });

      const scheduledFor = new Date().toISOString();
      const { data, error } = await serviceClient.rpc('form_test_enqueue_schedule_run', {
        p_schedule_id: schedule.id,
        p_scheduled_for: scheduledFor,
        p_requested_by: userId,
      });
      if (error) throw new HttpError(500, error.message);
      return toJson({ run: Array.isArray(data) ? data[0] : data }, 202);
    }

    if (action === 'refresh_snapshot') {
      const { data, error } = await serviceClient.rpc('form_test_refresh_schedule_snapshot', {
        p_schedule_id: schedule.id,
        p_updated_by: userId,
      });
      if (error) throw new HttpError(400, error.message);
      return toJson({ schedule: data });
    }

    if (action === 'update') {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
      if (typeof body.environment === 'string' && body.environment.trim()) updates.environment = body.environment.trim();
      if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

      if (body.start_at || body.frequency || body.timezone || body.end_at !== undefined) {
        const frequency = body.frequency ?? schedule.frequency;
        const timezone = body.timezone?.trim() || schedule.timezone;
        const startAt = body.start_at ?? schedule.start_at;
        const dayOfWeek = frequency === 'weekly' ? body.day_of_week ?? schedule.day_of_week : null;
        const dayOfMonth = frequency === 'monthly' ? body.day_of_month ?? schedule.day_of_month : null;
        const endAt = body.end_at === undefined ? schedule.end_at : body.end_at;
        const localTime = new Date(startAt).toLocaleTimeString('en-GB', {
          timeZone: timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const { data: nextRun, error: nextError } = await serviceClient.rpc('form_test_schedule_next_run', {
          p_frequency: frequency,
          p_timezone: timezone,
          p_start_at: startAt,
          p_local_time: localTime,
          p_day_of_week: dayOfWeek,
          p_day_of_month: dayOfMonth,
          p_after: new Date(Date.now() - 1000).toISOString(),
        });
        if (nextError) throw new HttpError(400, nextError.message);
        updates.frequency = frequency;
        updates.timezone = timezone;
        updates.start_at = startAt;
        updates.local_time = localTime;
        updates.day_of_week = dayOfWeek;
        updates.day_of_month = dayOfMonth;
        updates.end_at = endAt || null;
        updates.next_run_at = nextRun;
        updates.is_active = typeof body.is_active === 'boolean' ? body.is_active : Boolean(nextRun);
      }

      const { data, error } = await serviceClient
        .from('workflow_schedules')
        .update(updates)
        .eq('id', schedule.id)
        .select('*')
        .single();
      if (error) throw new HttpError(400, error.message);
      return toJson({ schedule: data });
    }

    throw new HttpError(400, 'Action non supportee');
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
