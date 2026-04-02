import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { NotificationItem } from './notification-item';
import { useMarkAllAsRead } from './hooks/use-notification-actions';
import { notificationKeys } from './hooks/query-keys';
import { useNotificationUiStore } from '@/stores/notification-ui-store';
import { api } from '@/lib/api-client';
import type { Notification } from './hooks/use-notifications';

interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
}

export function NotificationDropdown() {
  const isOpen = useNotificationUiStore((s) => s.isDropdownOpen);
  const setDropdownOpen = useNotificationUiStore((s) => s.setDropdownOpen);
  const markAllAsRead = useMarkAllAsRead();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: notificationKeys.unreadList(),
    queryFn: () =>
      api.get<NotificationPage>('/v1/notifications?status=unread&limit=5'),
    staleTime: 10_000,
    enabled: isOpen,
  });

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, setDropdownOpen]);

  if (!isOpen) return null;

  const notifications = data?.items ?? [];

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-80 rounded-lg border bg-card shadow-lg"
      role="menu"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">Notifications</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => markAllAsRead.mutate(undefined)}
          disabled={notifications.length === 0 || markAllAsRead.isPending}
        >
          Mark all as read
        </Button>
      </div>

      <Separator />

      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            You're all caught up!
          </p>
        ) : (
          notifications.map((n) => (
            <div key={n.id} onClick={() => setDropdownOpen(false)} role="menuitem">
              <NotificationItem notification={n} compact />
            </div>
          ))
        )}
      </div>

      <Separator />

      <div className="px-4 py-2">
        <Link
          to="/notifications"
          onClick={() => setDropdownOpen(false)}
          className="block text-center text-sm font-medium text-primary hover:underline"
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}
