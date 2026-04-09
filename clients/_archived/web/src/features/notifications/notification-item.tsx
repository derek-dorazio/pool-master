import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Trophy,
  Flag,
  Users,
  MessageCircle,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMarkAsRead } from './hooks/use-notification-actions';
import type { Notification, NotificationCategory } from './hooks/use-notifications';

const categoryIcons: Record<NotificationCategory, React.ElementType> = {
  draft: ClipboardList,
  scoring: Trophy,
  contest: Flag,
  league: Users,
  social: MessageCircle,
  account: Settings,
};

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const diff = now - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

interface NotificationItemProps {
  notification: Notification;
  compact?: boolean;
}

export function NotificationItem({ notification, compact }: NotificationItemProps) {
  const navigate = useNavigate();
  const markAsRead = useMarkAsRead();
  const Icon = categoryIcons[notification.category];

  function handleClick() {
    if (!notification.read) {
      markAsRead.mutate(notification.id);
    }
    navigate(notification.targetUrl);
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-accent',
        !notification.read && 'bg-accent/40',
        compact && 'py-2',
      )}
      role="article"
      aria-label={`${notification.read ? '' : 'unread '}${notification.title}`}
    >
      {!notification.read && (
        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      )}
      {notification.read && <span className="mt-2 h-2 w-2 shrink-0" aria-hidden="true" />}

      <div className="shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', !notification.read && 'font-semibold')}>
          {notification.title}
        </p>
        {!compact && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notification.body}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(notification.createdAt)}
        </span>
        {!compact && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    </button>
  );
}
