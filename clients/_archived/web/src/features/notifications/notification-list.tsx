import { useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationItem } from './notification-item';
import { NotificationEmptyState } from './notification-empty-state';
import { useNotifications, type Notification } from './hooks/use-notifications';
import { useNotificationUiStore } from '@/stores/notification-ui-store';
import { Button } from '@/components/ui/button';

function getDateGroup(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'This Week';
  return 'Older';
}

function groupNotifications(notifications: Notification[]): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();
  const order = ['Today', 'Yesterday', 'This Week', 'Older'];
  for (const label of order) {
    groups.set(label, []);
  }
  for (const n of notifications) {
    const group = getDateGroup(n.createdAt);
    groups.get(group)!.push(n);
  }
  // Remove empty groups
  for (const [key, items] of groups) {
    if (items.length === 0) groups.delete(key);
  }
  return groups;
}

function NotificationListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="h-2 w-2 rounded-full mt-2" />
          <Skeleton className="h-4 w-4 mt-0.5" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function NotificationList() {
  const activeCategory = useNotificationUiStore((s) => s.activeCategory);
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useNotifications(activeCategory ?? undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  if (isLoading) return <NotificationListSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load notifications</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const allNotifications = data?.pages.flatMap((p) => p.items) ?? [];

  if (allNotifications.length === 0) {
    return <NotificationEmptyState category={activeCategory ?? undefined} />;
  }

  const grouped = groupNotifications(allNotifications);

  return (
    <div role="feed" aria-busy={isFetchingNextPage} className="space-y-4">
      {Array.from(grouped.entries()).map(([label, items]) => (
        <div key={label}>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div className="space-y-0.5">
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} />
            ))}
          </div>
        </div>
      ))}

      <div ref={sentinelRef} />

      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}
