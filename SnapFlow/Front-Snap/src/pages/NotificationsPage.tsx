import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/dateFormat';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  category: string;
  is_read: boolean;
  created_at: string;
}

const typeDots: Record<string, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
};

const NotificationsPage = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetch_ = async () => {
    if (!user) return;
    let q = supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (filter === 'unread') q = q.eq('is_read', false);
    const { data } = await q;
    setNotifications((data as Notification[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetch_(); }, [user, filter]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notif-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => fetch_())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true } as any).eq('id', id);
    fetch_();
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true } as any).eq('user_id', user.id).eq('is_read', false);
    fetch_();
  };

  const del = async (id: string) => {
    await supabase.from('notifications').delete().eq('id', id);
    fetch_();
  };

  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Centre de notifications</h1>
            <p className="text-sm text-muted-foreground">{unread} non lue{unread > 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            <button onClick={() => setFilter('all')} className={cn('px-3 py-1 text-xs rounded-md transition', filter === 'all' && 'bg-background shadow text-foreground')}>Toutes</button>
            <button onClick={() => setFilter('unread')} className={cn('px-3 py-1 text-xs rounded-md transition', filter === 'unread' && 'bg-background shadow text-foreground')}>Non lues</button>
          </div>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} className="text-xs">
              <CheckCheck className="w-3 h-3 mr-1" /> Tout marquer lu
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="glass-card p-8 text-center text-muted-foreground">Chargement…</div>
      ) : notifications.length === 0 ? (
        <div className="glass-card p-12 text-center text-muted-foreground">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Aucune notification</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div key={n.id} className={cn('glass-card p-4 flex items-start gap-3', !n.is_read && 'border-primary/20 bg-primary/5')}>
              <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0', typeDots[n.type] || typeDots.info)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatDateTime(n.created_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] bg-muted px-2 py-0.5 rounded">{n.category}</span>
                  {!n.is_read && (
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => markRead(n.id)}>
                      <Check className="w-3 h-3 mr-1" /> Marquer lu
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive" onClick={() => del(n.id)}>
                    <Trash2 className="w-3 h-3 mr-1" /> Supprimer
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
