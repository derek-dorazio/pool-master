import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { client, createSelfExclusion, getActiveExclusion } from '@/lib/api';
import {
  ActiveExclusionResponseSchema,
  type SelfExclusionDuration,
} from '@poolmaster/shared/dto/compliance.dto';
import { settingsKeys } from './hooks/query-keys';

type ExclusionType = 'COOL_DOWN' | 'SELF_EXCLUSION';

const exclusionOptions = {
  COOL_DOWN: [
    { value: '24H', label: '24 Hours' },
    { value: '7D', label: '7 Days' },
    { value: '30D', label: '30 Days' },
  ],
  SELF_EXCLUSION: [
    { value: '6M', label: '6 Months' },
    { value: '1Y', label: '1 Year' },
    { value: 'INDEFINITE', label: 'Until I Reactivate My Account' },
  ],
} as const satisfies Record<ExclusionType, ReadonlyArray<{ value: SelfExclusionDuration; label: string }>>;

const exclusionDescriptions: Record<ExclusionType, string> = {
  COOL_DOWN: 'Take a temporary break. You can return automatically when the cool-down ends.',
  SELF_EXCLUSION: 'Use this for a longer pause. Indefinite exclusions stay active until you reactivate them.',
};

function getDurationLabel(type: ExclusionType, duration: SelfExclusionDuration): string {
  return exclusionOptions[type].find((option) => option.value === duration)?.label ?? duration;
}

export function SelfExclusionCard() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exclusionType, setExclusionType] = useState<ExclusionType>('COOL_DOWN');
  const [period, setPeriod] = useState<SelfExclusionDuration>('24H');
  const [typed, setTyped] = useState('');
  const activeExclusionQuery = useQuery({
    queryKey: settingsKeys.selfExclusion(),
    queryFn: async () => {
      const { data, error } = await getActiveExclusion({ client });
      if (error) throw error;
      return ActiveExclusionResponseSchema.parse(data);
    },
  });

  const createExclusion = useMutation({
    mutationFn: async () => {
      const { data, error } = await createSelfExclusion({
        client,
        body: { type: exclusionType, duration: period },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      const periodLabel = getDurationLabel(exclusionType, period);
      toast({
        title: 'Self-exclusion activated',
        description: exclusionType === 'COOL_DOWN'
          ? `Your account will be paused for ${periodLabel}.`
          : period === 'INDEFINITE'
            ? 'Your account will remain paused until you reactivate it.'
            : `Your account will be paused for ${periodLabel}.`,
      });
      setDialogOpen(false);
      setExclusionType('COOL_DOWN');
      setPeriod('24H');
      setTyped('');
      await queryClient.invalidateQueries({ queryKey: settingsKeys.selfExclusion() });
    },
    onError: () => {
      toast({ title: 'Failed to activate self-exclusion' });
    },
  });

  async function handleConfirm() {
    await createExclusion.mutateAsync();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Self-Exclusion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Take a break from Ultimate Pool Manager. During the cool-down period, you won't be able to enter
            contests or participate in drafts.
          </p>
          {activeExclusionQuery.data?.exclusion ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">
                {activeExclusionQuery.data.exclusion.exclusionType === 'SELF_EXCLUSION'
                  ? 'Self-exclusion is active'
                  : 'Cool-down is active'}
              </p>
              <p className="mt-1">
                {getDurationLabel(
                  activeExclusionQuery.data.exclusion.exclusionType === 'SELF_EXCLUSION' ? 'SELF_EXCLUSION' : 'COOL_DOWN',
                  activeExclusionQuery.data.exclusion.duration as SelfExclusionDuration,
                )}{' '}
                started on{' '}
                {new Date(activeExclusionQuery.data.exclusion.startedAt).toLocaleDateString()}.
              </p>
            </div>
          ) : null}
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            Take a Break
          </Button>
        </CardContent>
      </Card>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDialogOpen(false)} aria-hidden="true" />
          <div className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg" role="alertdialog" aria-modal="true">
            <h2 className="text-lg font-semibold">Self-Exclusion</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose how long you'd like to pause your account. During this time you won't be able
              to enter contests or participate in drafts.
            </p>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Break type
              </p>
              <div className="space-y-2">
                {(
                  [
                    ['COOL_DOWN', 'Temporary cool-down'],
                    ['SELF_EXCLUSION', 'Long-term self-exclusion'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                      exclusionType === value ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="exclusion-type"
                      value={value}
                      checked={exclusionType === value}
                      onChange={() => {
                        setExclusionType(value);
                        setPeriod(exclusionOptions[value][0].value);
                      }}
                      className="accent-primary"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {exclusionDescriptions[exclusionType]}
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Duration
              </p>
              {exclusionOptions[exclusionType].map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                    period === opt.value ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="cooldown"
                    value={opt.value}
                    checked={period === opt.value}
                    onChange={() => setPeriod(opt.value)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm">
                Type <strong>CONFIRM</strong> to activate self-exclusion:
              </p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="CONFIRM"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDialogOpen(false); setTyped(''); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={typed !== 'CONFIRM' || createExclusion.isPending}
              >
                {createExclusion.isPending ? 'Activating...' : 'Activate Self-Exclusion'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
