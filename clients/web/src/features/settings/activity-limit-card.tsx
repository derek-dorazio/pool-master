import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { client } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsKeys } from './hooks/query-keys';

function parseActivityLimitResponse(data: unknown) {
  if (!data || typeof data !== 'object' || !('activityLimit' in data)) {
    throw new Error('Activity limit response was empty.');
  }

  const response = data as {
    activityLimit?: {
      enabled?: boolean;
      weeklyContestLimit?: number;
    };
  };

  return {
    activityLimit: {
      enabled: response.activityLimit?.enabled === true,
      weeklyContestLimit: typeof response.activityLimit?.weeklyContestLimit === 'number'
        ? response.activityLimit.weeklyContestLimit
        : 10,
    },
  };
}

export function ActivityLimitCard() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [weeklyLimit, setWeeklyLimit] = useState(10);

  const activityLimitQuery = useQuery({
    queryKey: settingsKeys.activityLimit(),
    queryFn: async () => {
      const { data, error } = await client.get({ url: '/api/v1/account/activity-limit' });
      if (error) throw error;
      return parseActivityLimitResponse(data);
    },
  });

  useEffect(() => {
    if (activityLimitQuery.data?.activityLimit) {
      setEnabled(activityLimitQuery.data.activityLimit.enabled);
      setWeeklyLimit(activityLimitQuery.data.activityLimit.weeklyContestLimit);
    }
  }, [activityLimitQuery.data]);

  const saveActivityLimit = useMutation({
    mutationFn: async (next: { enabled: boolean; weeklyContestLimit: number }) => {
      const { data, error } = await client.put({
        url: '/api/v1/account/activity-limit',
        body: next,
        headers: { 'Content-Type': 'application/json' },
      });
      if (error) throw error;
      return parseActivityLimitResponse(data);
    },
    onSuccess: async (data) => {
      setEnabled(data.activityLimit.enabled);
      setWeeklyLimit(data.activityLimit.weeklyContestLimit);
      toast({ title: data.activityLimit.enabled ? 'Activity limits enabled' : 'Activity limits disabled' });
      await queryClient.invalidateQueries({ queryKey: settingsKeys.activityLimit() });
    },
    onError: () => {
      toast({ title: 'Failed to save activity limits', description: 'Please try again.' });
    },
  });

  function handleToggle(checked: boolean) {
    setEnabled(checked);
    void saveActivityLimit.mutateAsync({ enabled: checked, weeklyContestLimit: weeklyLimit });
  }

  function handleLimitChange(value: string) {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1 && num <= 100) {
      setWeeklyLimit(num);
      if (enabled) {
        void saveActivityLimit.mutateAsync({ enabled, weeklyContestLimit: num });
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
            disabled={activityLimitQuery.isLoading || saveActivityLimit.isPending}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Set a maximum number of contests you can enter per week to help manage your time.
        </p>
        {activityLimitQuery.isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : activityLimitQuery.isError ? (
          <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
            <p>We couldn't load your activity limit settings.</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => void activityLimitQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
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
              disabled={saveActivityLimit.isPending}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
