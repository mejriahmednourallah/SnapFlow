// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  createServiceClient,
  getAuthUserId,
  HttpError,
  toJson,
} from '../_shared/formTester.ts';

const ARTIFACT_BUCKET = Deno.env.get('FORM_EXECUTOR_ARTIFACT_BUCKET') || 'form-test-artifacts';
const RETENTION_DAYS = 30;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

    if (token !== serviceRole) {
      const userId = await getAuthUserId(req);
      const { data: admin, error } = await serviceClient.rpc('has_role', {
        _user_id: userId,
        _role: 'admin',
      });
      if (error) throw new HttpError(500, error.message);
      if (!admin) throw new HttpError(403, 'Acces reserve aux administrateurs');
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: artifacts, error: selectError } = await serviceClient
      .from('workflow_artifacts')
      .select('id, storage_path, metadata_redacted, created_at')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (selectError) throw new HttpError(500, selectError.message);

    const remoteArtifacts = (artifacts ?? []).filter((artifact) => {
      const metadata = artifact.metadata_redacted &&
        typeof artifact.metadata_redacted === 'object'
        ? artifact.metadata_redacted
        : {};
      return metadata.storage_backend === 'supabase' && metadata.upload_status === 'available';
    });
    const remotePaths = remoteArtifacts.map((artifact) => artifact.storage_path).filter(Boolean);
    if (remotePaths.length > 0) {
      const { error: removeError } = await serviceClient.storage
        .from(ARTIFACT_BUCKET)
        .remove(remotePaths);
      if (removeError) {
        throw new HttpError(502, `Suppression Storage impossible: ${removeError.message}`);
      }
    }

    const artifactIds = (artifacts ?? []).map((artifact) => artifact.id);
    if (artifactIds.length > 0) {
      const { error: deleteError } = await serviceClient
        .from('workflow_artifacts')
        .delete()
        .in('id', artifactIds);
      if (deleteError) throw new HttpError(500, deleteError.message);
    }

    return toJson({
      success: true,
      retention_days: RETENTION_DAYS,
      cutoff,
      deleted_records: artifactIds.length,
      deleted_storage_objects: remotePaths.length,
      has_more: artifactIds.length === limit,
    });
  } catch (error) {
    if (error instanceof HttpError) return toJson({ error: error.message }, error.status);
    return toJson({ error: error instanceof Error ? error.message : 'Erreur serveur' }, 500);
  }
});
