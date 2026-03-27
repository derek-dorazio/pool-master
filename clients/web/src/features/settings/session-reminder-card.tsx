import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

const intervalOptions = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes' },
  { value: 90, label: '90 minutes' },
];

export function SessionReminderCard() {
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState(60);

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    // TODO: await api.patch('/users/me/preferences', { sessionReminder: { enabled: checked, intervalMinutes: interval } });
    toast({ title: checked ? 'Session reminders enabled' : 'Session reminders disabled' });
  }

  function handleIntervalChange(value: number) {
    setInterval(value);
    if (enabled) {
      // TODO: auto-save
      toast({ title: `Reminder interval set to ${value} minutes` });
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
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Receive a reminder after you've been active for a set period.
        </p>
        <div className={enabled ? 'mt-4' : 'mt-4 pointer-events-none opacity-50'}>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="session-interval">
            Reminder interval
          </label>
          <select
            id="session-interval"
            value={interval}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm sm:w-48"
          >
            {intervalOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  );
}
