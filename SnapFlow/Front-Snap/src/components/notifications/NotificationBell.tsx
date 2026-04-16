import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NotificationPanel } from './NotificationPanel';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { unreadCount, refresh } = useRealtimeNotifications('notifications-bell', 1);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 relative"
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
      {open && <NotificationPanel onClose={() => setOpen(false)} onUpdate={refresh} />}
    </>
  );
}
