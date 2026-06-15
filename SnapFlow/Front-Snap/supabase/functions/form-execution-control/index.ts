// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface ControlBody {
  execution_id?: string;
  command?: 'stop' | 'retry' | 'run_step' | 'run_from';
  node_id?: string;
}

async function getIsAdmin(serviceClient: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (error) throw new HttpError(500, error.message);
  return Boolean(data);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    const isAdmin = await getIsAdmin(serviceClient, userId);
    const body = (await req.json()) as ControlBody;

    if (!body.execution_id || !body.command) {
      throw new HttpError(400, 'execution_id et command sont requis');
    }
    if ((body.command === 'run_step' || body.command === 'run_from') && !body.node_id) {
      throw new HttpError(400, 'node_id requis pour cette commande');
    }

    const { data: execution, error: executionError } = await serviceClient
      .from('workflow_results')
      .select('*, form_workflows!inner(created_by, org_id)')
      .eq('id', body.execution_id)
      .maybeSingle();
    if (executionError) throw new HttpError(500, executionError.message);
    if (!execution) throw new HttpError(404, 'Execution non trouvee');

    const workflow = execution.form_workflows;
    if (!isAdmin && workflow.created_by !== userId && workflow.org_id !== userId) {
      throw new HttpError(403, 'Acces refuse');
    }

    if (body.command === 'stop' && !['queued', 'running', 'stopping'].includes(execution.status)) {
      throw new HttpError(409, `Impossible d arreter une execution ${execution.status}`);
    }

    const commandStatus = body.command === 'stop' && execution.status === 'queued' ? 'completed' : 'pending';
    const processedAt = commandStatus === 'completed' ? new Date().toISOString() : null;
    const { data: command, error: commandError } = await serviceClient
      .from('workflow_execution_commands')
      .insert({
        execution_id: execution.id,
        command: body.command,
        node_id: body.node_id ?? null,
        status: commandStatus,
        requested_by: userId,
        processed_at: processedAt,
        payload_redacted: {},
      })
      .select('*')
      .single();
    if (commandError) throw new HttpError(500, commandError.message);

    if (body.command === 'stop') {
      const nextStatus = execution.status === 'queued' ? 'cancelled' : 'stopping';
      const stoppedAt = nextStatus === 'cancelled' ? new Date().toISOString() : null;
      const { error: updateError } = await serviceClient
        .from('workflow_results')
        .update({
          status: nextStatus,
          stopped_at: stoppedAt,
          completed_at: stoppedAt,
          failure_reason: nextStatus === 'cancelled' ? 'cancelled_before_start' : null,
        })
        .eq('id', execution.id);
      if (updateError) throw new HttpError(500, updateError.message);

      await serviceClient.from('workflow_logs').insert({
        execution_id: execution.id,
        level: 'info',
        event_type: nextStatus === 'cancelled' ? 'execution_cancelled' : 'stop_requested',
        message:
          nextStatus === 'cancelled'
            ? 'Execution annulee avant son demarrage.'
            : 'Arret demande; le moteur terminera l etape en cours.',
        details_redacted: {},
      });
    } else {
      await serviceClient.from('workflow_logs').insert({
        execution_id: execution.id,
        level: 'info',
        event_type: 'execution_command_requested',
        message: `Commande ${body.command} ajoutee a la file.`,
        details_redacted: { node_id: body.node_id ?? null },
      });
    }

    return toJson({ success: true, command }, 202);
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
