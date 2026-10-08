import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchProjectDetail } from '@/services/redmineService';
import { supabase } from '@/integrations/supabase/client';

export interface AssignedUser {
  full_name: string | null;
  email: string;
}

export interface UseProjectAssignmentsReturn {
  assignedUser: AssignedUser | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches the assigned user profile for a project.
 * Replaces duplicated assignment-lookup logic in AdminProjects.tsx and ProjectDetail.tsx.
 */
export function useProjectAssignments(projectId: string | null | undefined): UseProjectAssignmentsReturn {
  const { user, userRole } = useAuth();
  const query = useQuery({
    queryKey: ['assignment', user?.id, userRole, projectId, 'display'],
    enabled: !!user && !!projectId,
    queryFn: async ({ signal }): Promise<AssignedUser | null> => {
      const { data: assignments, error: assignmentError } = await supabase.from('project_assignments')
        .select('user_id').eq('project_id', projectId!).limit(1).abortSignal(signal);
      if (assignmentError) throw assignmentError;
      if (assignments?.length) {
        const { data, error } = await supabase.from('profiles').select('full_name, email')
          .eq('id', assignments[0].user_id).abortSignal(signal).maybeSingle();
        if (error) throw error;
        return data;
      }
      const { data: row, error } = await supabase.from('projects').select('url, redmine_url')
        .eq('id', projectId!).abortSignal(signal).maybeSingle();
      if (error) throw error;
      const rawUrl = row?.redmine_url || row?.url;
      if (!rawUrl) return null;
      let identifier: string | undefined;
      try { identifier = new URL(rawUrl).pathname.match(/\/projects\/([^/]+)/)?.[1]; } catch { return null; }
      if (!identifier) return null;
      const detail = await fetchProjectDetail(identifier, user!.id);
      signal.throwIfAborted();
      const member = detail?.memberships?.find(m => m.roles?.some(r =>
        r.name?.toLowerCase().includes('account') || r.id === 9 || r.id === 10));
      const field = detail?.custom_fields?.find(f => /account|compte|charg/i.test(f.name ?? ''));
      const name = member?.user?.name || (typeof field?.value === 'string' ? field.value : null);
      if (!name) return null;
      const email = typeof field?.value === 'string' && field.value.includes('@') ? field.value : '';
      // Equality queries avoid interpolating Redmine values into PostgREST filters.
      const matches = await Promise.all([
        supabase.from('profiles').select('full_name, email').ilike('full_name', name).limit(1).abortSignal(signal),
        supabase.from('profiles').select('full_name, email').ilike('email', email || name).limit(1).abortSignal(signal),
      ]);
      for (const result of matches) if (result.error) throw result.error;
      return matches[0].data?.[0] ?? matches[1].data?.[0] ?? { full_name: name, email };
    },
  });
  return { assignedUser: query.data ?? null, loading: !!projectId && !!user && query.isPending, error: query.error };
}
