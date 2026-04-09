import { cn } from '@/lib/utils';
import { useUnreadCount } from './hooks/use-unread-count';
import { useNotificationUiStore } from '@/stores/notification-ui-store';
import { Badge } from '@/components/ui/badge';

const categories = [
  { key: null, label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'contest', label: 'Contest' },
  { key: 'league', label: 'League' },
  { key: 'social', label: 'Social' },
  { key: 'account', label: 'Account' },
] as const;

export function CategoryFilter() {
  const activeCategory = useNotificationUiStore((s) => s.activeCategory);
  const setActiveCategory = useNotificationUiStore((s) => s.setActiveCategory);
  const { data: unreadCounts } = useUnreadCount();

  function getCount(key: string | null): number {
    if (!unreadCounts) return 0;
    if (key === null) return unreadCounts.total;
    return unreadCounts.grouped[key] ?? 0;
  }

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
      role="tablist"
      aria-label="Notification categories"
    >
      {categories.map(({ key, label }) => {
        const isActive = activeCategory === key;
        const count = getCount(key);
        return (
          <button
            key={label}
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveCategory(key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {label}
            {count > 0 && (
              <Badge
                variant={isActive ? 'secondary' : 'default'}
                className="h-5 min-w-5 justify-center rounded-full px-1.5 text-xs"
              >
                {count}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
