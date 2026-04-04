import { useCallback, useEffect, useRef } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationPreferences,
  type DndSettings,
} from './hooks/use-notification-preferences';

const HOURS_12 = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const period = i < 12 ? 'AM' : 'PM';
  return { value: `${String(i).padStart(2, '0')}:00`, label: `${h}:00 ${period}` };
});

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function DNDScheduler() {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const savePreferences = useSaveNotificationPreferences();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const latestPreferencesRef = useRef<NotificationPreferences | null>(null);
  const latestDndRef = useRef<DndSettings | null>(null);

  useEffect(() => {
    latestPreferencesRef.current = preferences ?? null;
    latestDndRef.current = preferences?.dnd ?? null;
  }, [preferences]);

  const save = useCallback(
    (partial: Partial<DndSettings>) => {
      const currentPreferences = latestPreferencesRef.current;
      const currentDnd = latestDndRef.current;
      if (!currentPreferences || !currentDnd) return;
      const nextDnd = { ...currentDnd, ...partial };
      const nextPreferences = { ...currentPreferences, dnd: nextDnd };
      latestPreferencesRef.current = nextPreferences;
      latestDndRef.current = nextDnd;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        savePreferences.mutate(nextPreferences);
      }, 1000);
    },
    [savePreferences],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (isLoading || !preferences) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Do Not Disturb</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-12" />
          <div className="flex gap-4">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const { dnd } = preferences;

  function updateDnd(partial: Partial<DndSettings>) {
    save(partial);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Do Not Disturb</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={dnd.enabled}
              onCheckedChange={(val) => updateDnd({ enabled: val === true })}
            />
            {dnd.enabled ? 'On' : 'Off'}
          </label>
        </div>
      </CardHeader>
      <CardContent>
        <div className={dnd.enabled ? '' : 'pointer-events-none opacity-50'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="dnd-start">
                Start
              </label>
              <select
                id="dnd-start"
                value={dnd.startTime}
                onChange={(e) => updateDnd({ startTime: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm sm:w-36"
                aria-label="Quiet hours start time"
              >
                {HOURS_12.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="dnd-end">
                End
              </label>
              <select
                id="dnd-end"
                value={dnd.endTime}
                onChange={(e) => updateDnd({ endTime: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm sm:w-36"
                aria-label="Quiet hours end time"
              >
                {HOURS_12.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="dnd-tz">
                Timezone
              </label>
              <select
                id="dnd-tz"
                value={dnd.timezone}
                onChange={(e) => updateDnd({ timezone: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm sm:w-48"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            During quiet hours, in-app and push notifications are silenced. You'll still receive
            emails, and all notifications will be waiting in your inbox when quiet hours end.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
