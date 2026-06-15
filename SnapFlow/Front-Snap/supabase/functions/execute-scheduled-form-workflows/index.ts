// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (token !== serviceRole) {
      const userId = await getAuthUserId(req);
      const { data: admin, error } = await serviceClient.rpc('has_role', {
        _user_id: userId,
        _role: 'admin',
      });
      if (error) throw new HttpError(500, error.message);
      if (!admin) throw new HttpError(403, 'Acces reserve aux administrateurs');
    }

    const { data, error } = await serviceClient.rpc('form_test_dispatch_due_schedules', {
      p_limit: 50,
    });
    if (error) throw new HttpError(500, error.message);
    return toJson({ dispatched: data?.length ?? 0, executions: data ?? [] });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
