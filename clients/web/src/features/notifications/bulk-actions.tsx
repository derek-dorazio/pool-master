import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMarkAllAsRead } from './hooks/use-notification-actions';
import { useUnreadCount } from './hooks/use-unread-count';
import { useNotificationUiStore } from '@/stores/notification-ui-store';

export function BulkActions() {
  const [showConfirm, setShowConfirm] = useState(false);
  const activeCategory = useNotificationUiStore((s) => s.activeCategory);
  const markAllAsRead = useMarkAllAsRead();
  const { data: unreadCounts } = useUnreadCount();

  const unreadCount = activeCategory
    ? (unreadCounts?.grouped[activeCategory] ?? 0)
    : (unreadCounts?.total ?? 0);

  function handleMarkAllRead() {
    if (unreadCount > 50) {
      setShowConfirm(true);
      return;
    }
    markAllAsRead.mutate(activeCategory ?? undefined);
  }

  function handleConfirm() {
    setShowConfirm(false);
    markAllAsRead.mutate(activeCategory ?? undefined);
  }

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {unreadCount > 0 ? `${unreadCount} unread` : 'No unread notifications'}
      </p>

      {showConfirm ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Mark {unreadCount} as read?
          </span>
          <Button size="sm" variant="outline" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={markAllAsRead.isPending}>
            Confirm
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMarkAllRead}
          disabled={unreadCount === 0 || markAllAsRead.isPending}
        >
          Mark all as read
        </Button>
      )}
    </div>
  );
}
