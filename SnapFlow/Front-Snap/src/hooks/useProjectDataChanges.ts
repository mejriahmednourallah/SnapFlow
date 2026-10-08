import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { queryClient } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';

export function useProjectDataChanges() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasSubscribed = false;
    const invalidate = () => {
      for (const key of ['project-list', 'project', 'assignment', 'audit-list', 'audit-report', 'user-role']) {
        void queryClient.invalidateQueries({ queryKey: [key, user.id] });
      }
    };
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(invalidate, 100);
    };
    let channel = supabase.channel(`project-data-${user.id}`);
    for (const table of ['projects', 'project_assignments', 'clients', 'profiles', 'redmine_user_identities', 'report_schedules']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${user.id}` }, refresh)
      .subscribe(status => {
        // Initial sign-in clears the cache. Reconnect must refresh missed changes.
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed) refresh();
          hasSubscribed = true;
        }
      });
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [user?.id]);
}
