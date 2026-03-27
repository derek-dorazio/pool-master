import { useCallback, useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CategoryRow, CategoryRowMobile } from './category-row';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationPreferences,
  type CategoryPreference,
} from './hooks/use-notification-preferences';
import { usePushPermission } from './hooks/use-push-permission';

const CATEGORY_ORDER = ['draft', 'scoring', 'contest', 'league', 'social', 'account'];
const CHANNELS: (keyof CategoryPreference)[] = ['inApp', 'push', 'email'];
const CHANNEL_LABELS: Record<string, string> = {
  inApp: 'In-App',
  push: 'Push',
  email: 'Email',
};

export function PreferencesMatrix() {
  const { data: preferences, isLoading, isError, refetch } = useNotificationPreferences();
  const savePreferences = useSaveNotificationPreferences();
  const { isGranted } = usePushPermission();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<NotificationPreferences | null>(null);

  const save = useCallback(
    (updated: NotificationPreferences) => {
      pendingRef.current = updated;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (pendingRef.current) {
          savePreferences.mutate(pendingRef.current);
          pendingRef.current = null;
        }
      }, 1000);
    },
    [savePreferences],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-5" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !preferences) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load preferences</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  function handleToggle(category: string, channel: keyof CategoryPreference, value: boolean) {
    const updated: NotificationPreferences = {
      ...preferences!,
      categories: {
        ...preferences!.categories,
        [category]: {
          ...preferences!.categories[category],
          [channel]: value,
        },
      },
    };
    save(updated);
  }

  function handleToggleColumn(channel: keyof CategoryPreference) {
    const allEnabled = CATEGORY_ORDER.every((cat) => {
      if (cat === 'account' && (channel === 'inApp' || channel === 'email')) return true;
      return preferences!.categories[cat]?.[channel];
    });
    const newValue = !allEnabled;
    const updatedCategories = { ...preferences!.categories };
    for (const cat of CATEGORY_ORDER) {
      if (cat === 'account' && (channel === 'inApp' || channel === 'email')) continue;
      updatedCategories[cat] = {
        ...updatedCategories[cat],
        [channel]: newValue,
      };
    }
    save({ ...preferences!, categories: updatedCategories });
  }

  return (
    <>
      {/* Desktop table — lg and above */}
      <div className="hidden lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="py-3 pr-4 text-left text-sm font-medium">Category</th>
              {CHANNELS.map((ch) => (
                <th key={ch} className="px-4 py-3 text-center text-sm font-medium">
                  <div className="flex flex-col items-center gap-1">
                    <span>{CHANNEL_LABELS[ch]}</span>
                    <Checkbox
                      checked={CATEGORY_ORDER.every((cat) => {
                        if (cat === 'account' && (ch === 'inApp' || ch === 'email')) return true;
                        return preferences.categories[cat]?.[ch];
                      })}
                      onCheckedChange={() => handleToggleColumn(ch)}
                      disabled={ch === 'push' && !isGranted}
                      aria-label={`Toggle all ${CHANNEL_LABELS[ch]}`}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((cat) => (
              <CategoryRow
                key={cat}
                category={cat}
                preference={preferences.categories[cat]}
                pushDisabled={!isGranted}
                onToggle={(channel, value) => handleToggle(cat, channel, value)}
              />
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          🔒 = Cannot be disabled
        </p>
      </div>

      {/* Mobile cards — below lg */}
      <div className="space-y-3 lg:hidden">
        {CATEGORY_ORDER.map((cat) => (
          <CategoryRowMobile
            key={cat}
            category={cat}
            preference={preferences.categories[cat]}
            pushDisabled={!isGranted}
            onToggle={(channel, value) => handleToggle(cat, channel, value)}
          />
        ))}
      </div>
    </>
  );
}
