import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string;
  is_read: boolean;
  created_at: string;
  reference_id: string | null;
  reference_type: string | null;
}

export interface UseRealtimeNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Manages Supabase realtime subscriptions for the notifications table.
 * Replaces the duplicated subscription logic in NotificationBell.tsx and NotificationPanel.tsx.
 *
 * @param channelName - a unique name for the Supabase realtime channel (prevents conflicts)
 * @param limit - max number of rows to fetch (default: 50)
 */
export function useRealtimeNotifications(
  channelName: string,
  limit = 50,
): UseRealtimeNotificationsReturn {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    setNotifications((data as Notification[]) || []);
    setLoading(false);
  }, [user, limit]);

  useEffect(() => {
    fetchNotifications();
    if (!user) return;

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchNotifications())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, channelName, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ is_read: true } as any).eq('id', id);
    await fetchNotifications();
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true } as any)
      .eq('user_id', user.id).eq('is_read', false);
    await fetchNotifications();
  }, [user, fetchNotifications]);

  const deleteNotification = useCallback(async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    await fetchNotifications();
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return {
    notifications, unreadCount, loading,
    markAsRead, markAllRead, deleteNotification, refresh: fetchNotifications,
  };
}
