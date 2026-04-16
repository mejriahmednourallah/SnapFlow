import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AssignedUser {
  full_name: string | null;
  email: string;
}

export interface UseProjectAssignmentsReturn {
  assignedUser: AssignedUser | null;
  loading: boolean;
}

/**
 * Fetches the assigned user profile for a project.
 * Replaces duplicated assignment-lookup logic in AdminProjects.tsx and ProjectDetail.tsx.
 */
export function useProjectAssignments(projectId: string | null | undefined): UseProjectAssignmentsReturn {
  const [assignedUser, setAssignedUser] = useState<AssignedUser | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    setLoading(true);

    const fetch = async () => {
      // 1) Supabase assignment
      const { data: assignments } = await supabase
        .from('project_assignments')
        .select('user_id')
        .eq('project_id', projectId)
        .limit(1);

      if (cancelled) return;
      if (assignments && assignments.length > 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', assignments[0].user_id)
          .single();

        if (!cancelled) {
          setAssignedUser(profile || null);
          setLoading(false);
        }
        return;
      }

      // 2) Fallback: Redmine "Account" membership or custom field
      const { data: projectRow } = await supabase
        .from('projects')
        .select('url, redmine_url')
        .eq('id', projectId)
        .single();

      const projectUrl = projectRow?.redmine_url || projectRow?.url;
      if (!projectUrl) {
        if (!cancelled) setLoading(false);
        return;
      }

      const redmineIdentifier = (() => {
        try {
          const url = new URL(projectUrl);
          const match = url.pathname.match(/\/projects\/([^/]+)/);
          if (match) return match[1];
        } catch {
          /* noop */
        }
        return null;
      })();

      if (!redmineIdentifier) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: redmineDetail } = await supabase.functions.invoke('fetch-redmine', {
        body: { type: 'project_detail', project_identifier: redmineIdentifier },
      });

      const project = redmineDetail?.project;
      const accountMember = project?.memberships?.find((m: any) =>
        m.roles?.some((r: any) => r.name?.toLowerCase()?.includes('account') || r.id === 9 || r.id === 10)
      );
      const customField = project?.custom_fields?.find((f: any) => {
        const n = (f.name || '').toLowerCase();
        return n.includes('account') || n.includes('compte') || n.includes('charg');
      });

      const displayName: string | null =
        accountMember?.user?.name ||
        (typeof customField?.value === 'string' ? customField.value : null) ||
        null;
      const displayEmail: string | null =
        typeof customField?.value === 'string' && customField.value.includes('@')
          ? customField.value
          : null;

      if (displayName) {
        // Try to map to a profile by full name OR email
        const { data: profileMatch } = await supabase
          .from('profiles')
          .select('full_name, email')
          .or(`full_name.ilike.${displayName},email.ilike.${displayEmail ?? displayName}`);

        const profile = profileMatch && profileMatch.length > 0 ? profileMatch[0] : { full_name: displayName, email: displayEmail ?? '' };

        if (!cancelled) {
          setAssignedUser(profile);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setLoading(false);
    };

    fetch();
    return () => { cancelled = true; };
  }, [projectId]);

  return { assignedUser, loading };
}
