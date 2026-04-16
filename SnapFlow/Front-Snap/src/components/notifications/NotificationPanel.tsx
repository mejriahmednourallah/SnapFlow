import { useNavigate } from 'react-router-dom';
import { X, Check, CheckCheck, Trash2, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

const typeColors: Record<string, string> = {
  info: 'bg-info/10 border-info/20',
  success: 'bg-success/10 border-success/20',
  warning: 'bg-warning/10 border-warning/20',
  error: 'bg-destructive/10 border-destructive/20',
};

const typeDots: Record<string, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
};

interface NotificationPanelProps {
  onClose: () => void;
  onUpdate: () => void;
}

export function NotificationPanel({ onClose, onUpdate }: NotificationPanelProps) {
  const navigate = useNavigate();
  const {
    notifications, unreadCount, loading,
    markAsRead, markAllRead, deleteNotification,
  } = useRealtimeNotifications('notifications-panel', 50);

  const handleMarkAsRead = async (n: typeof notifications[number]) => {
    await markAsRead(n.id);
    onUpdate();
    if (n.reference_id && n.reference_type === 'audit') {
      onClose();
      navigate(`/audit/${n.reference_id}/view`);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    onUpdate();
  };

  const handleDelete = async (id: string) => {
    await deleteNotification(id);
    onUpdate();
  };

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div
        className="absolute right-4 top-14 w-96 max-h-[70vh] bg-card border border-border rounded-xl shadow-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {unreadCount} non lue{unreadCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={handleMarkAllRead}>
                <CheckCheck className="w-3 h-3 mr-1" /> Tout lire
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Chargement…</div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              Aucune notification
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={cn(
                  'px-4 py-3 border-b border-border/50 transition-colors hover:bg-muted/30',
                  !n.is_read && 'bg-primary/5'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', typeDots[n.type] || typeDots.info)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-sm font-medium', !n.is_read && 'text-foreground', n.is_read && 'text-muted-foreground')}>
                        {n.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {format(new Date(n.created_at), 'dd/MM HH:mm', { locale: fr })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{n.category}</span>
                      {!n.is_read && (
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => handleMarkAsRead(n)}>
                          <Check className="w-3 h-3 mr-0.5" /> Lire
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-destructive" onClick={() => handleDelete(n.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
