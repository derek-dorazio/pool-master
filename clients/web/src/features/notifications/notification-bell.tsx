import { Bell } from 'lucide-react';
import { UnreadBadge } from './unread-badge';
import { NotificationDropdown } from './notification-dropdown';
import { useUnreadCount } from './hooks/use-unread-count';
import { useNotificationUiStore } from '@/stores/notification-ui-store';

export function NotificationBell() {
  const toggleDropdown = useNotificationUiStore((s) => s.toggleDropdown);
  const { data: unreadCounts } = useUnreadCount();
  const count = unreadCounts?.total ?? 0;

  return (
    <div className="relative">
      <button
        onClick={toggleDropdown}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={`Notifications, ${count} unread`}
      >
        <Bell className="h-5 w-5" />
        <UnreadBadge count={count} />
      </button>

      <NotificationDropdown />
    </div>
  );
}
