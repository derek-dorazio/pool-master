import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

export function ActivityLimitCard() {
  const [enabled, setEnabled] = useState(false);
  const [weeklyLimit, setWeeklyLimit] = useState(10);

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    // TODO: await api.patch('/users/me/preferences', { activityLimit: { enabled: checked, weeklyContestLimit: weeklyLimit } });
    toast({ title: checked ? 'Activity limits enabled' : 'Activity limits disabled' });
  }

  function handleLimitChange(value: string) {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1 && num <= 100) {
      setWeeklyLimit(num);
      if (enabled) {
        // TODO: auto-save
        toast({ title: `Weekly limit set to ${num} contests` });
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Activity Limits</CardTitle>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label="Enable activity limits"
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Set a maximum number of contests you can enter per week to help manage your time.
        </p>
        <div className={enabled ? 'mt-4' : 'mt-4 pointer-events-none opacity-50'}>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="weekly-limit">
            Weekly contest limit
          </label>
          <Input
            id="weekly-limit"
            type="number"
            min={1}
            max={100}
            value={weeklyLimit}
            onChange={(e) => handleLimitChange(e.target.value)}
            className="mt-1 w-24"
          />
        </div>
      </CardContent>
    </Card>
  );
}
