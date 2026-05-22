// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  ensureAdmin,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

interface ApproveBody {
  workflow_id?: string;
  action?: 'approve' | 'reject';
  note?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    const userId = await getAuthUserId(req);
    await ensureAdmin(serviceClient, userId);

    const body = (await req.json()) as ApproveBody;
    const workflowId = body.workflow_id;
    const action = body.action;
    const note = body.note?.trim();

    if (!workflowId || (action !== 'approve' && action !== 'reject')) {
      throw new HttpError(400, 'workflow_id et action (approve|reject) requis');
    }

    if (action === 'reject' && !note) {
      throw new HttpError(400, 'Une note est obligatoire pour rejeter le workflow');
    }

    const updatePayload =
      action === 'approve'
        ? {
            status: 'approved',
            approved_by: userId,
            approved_at: new Date().toISOString(),
            approval_note: note ?? null,
            rejection_note: null,
          }
        : {
            status: 'draft',
            approved_by: null,
            approved_at: null,
            approval_note: null,
            rejection_note: note,
          };

    const { data: workflow, error } = await serviceClient
      .from('form_workflows')
      .update(updatePayload)
      .eq('id', workflowId)
      .in('status', ['pending', 'needs_review'])
      .select('*')
      .maybeSingle();

    if (error) {
      throw new HttpError(500, error.message);
    }

    if (!workflow) {
      throw new HttpError(400, 'Workflow introuvable ou non soumis');
    }

    return toJson({ success: true, workflow, action });
  } catch (error) {
    if (error instanceof HttpError) {
      return toJson({ error: error.message }, error.status);
    }

    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return toJson({ error: message }, 500);
  }
});
