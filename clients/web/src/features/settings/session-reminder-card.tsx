import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { client, getSessionReminder, updateSessionReminder } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import {
  SessionReminderResponseSchema,
  SessionReminderUpdateRequestSchema,
} from '@poolmaster/shared/dto/compliance.dto';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsKeys } from './hooks/query-keys';

const intervalOptions = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
  { value: 90, label: '90 minutes' },
];

export function SessionReminderCard() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState(60);

  const reminderQuery = useQuery({
    queryKey: settingsKeys.sessionReminder(),
    queryFn: async () => {
      const { data, error } = await getSessionReminder({ client });
      if (error) throw error;
      return SessionReminderResponseSchema.parse(data);
    },
  });

  useEffect(() => {
    if (reminderQuery.data?.sessionReminder) {
      setEnabled(reminderQuery.data.sessionReminder.enabled);
      setInterval(reminderQuery.data.sessionReminder.intervalMinutes);
    }
  }, [reminderQuery.data]);

  const saveReminder = useMutation({
    mutationFn: async (next: { enabled: boolean; intervalMinutes: number }) => {
      const { data, error } = await updateSessionReminder({
        client,
        body: SessionReminderUpdateRequestSchema.parse(next),
      });
      if (error) throw error;
      return SessionReminderResponseSchema.parse(data);
    },
    onSuccess: async (data) => {
      setEnabled(data.sessionReminder.enabled);
      setInterval(data.sessionReminder.intervalMinutes);
      toast({ title: data.sessionReminder.enabled ? 'Session reminders enabled' : 'Session reminders disabled' });
      await queryClient.invalidateQueries({ queryKey: settingsKeys.sessionReminder() });
    },
    onError: () => {
      toast({ title: 'Failed to save session reminders', description: 'Please try again.' });
    },
  });

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    void saveReminder.mutateAsync({ enabled: checked, intervalMinutes: interval });
  }

  function handleIntervalChange(value: number) {
    setInterval(value);
    if (enabled) {
      void saveReminder.mutateAsync({ enabled, intervalMinutes: value });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Session Reminders</CardTitle>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label="Enable session reminders"
            disabled={reminderQuery.isLoading || saveReminder.isPending}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Receive a reminder after you've been active for a set period.
        </p>
        {reminderQuery.isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-48" />
          </div>
        ) : reminderQuery.isError ? (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
            <p>We couldn't load your session reminder settings.</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => void reminderQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className={enabled ? 'mt-4' : 'mt-4 pointer-events-none opacity-50'}>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="session-interval">
              Reminder interval
            </label>
            <select
              id="session-interval"
              value={interval}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm sm:w-48"
              disabled={saveReminder.isPending}
            >
              {intervalOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
