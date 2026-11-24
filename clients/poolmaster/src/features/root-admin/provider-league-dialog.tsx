import { zodResolver } from '@hookform/resolvers/zod';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { PROVIDER_LEAGUE_MINUTES_RANGE } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DetailEditModal, FormField, Input, showToast, type Fact } from '@/features/shared/ui';
import { OnOffField } from './on-off-field';
import type { ProviderLeagueRow } from './provider-league-columns';
import { useUpdateProviderLeague } from './use-update-provider';
import { wholeNumberIn } from './whole-number-field';

const leagueSchema = z.object({
  isEnabled: z.enum(['on', 'off']),
  typicalGameMinutes: wholeNumberIn(PROVIDER_LEAGUE_MINUTES_RANGE),
  quietAfterMinutes: wholeNumberIn(PROVIDER_LEAGUE_MINUTES_RANGE),
});

type LeagueValues = z.infer<typeof leagueSchema>;

function valuesOf(league: ProviderLeagueRow): LeagueValues {
  return {
    isEnabled: league.isEnabled ? 'on' : 'off',
    typicalGameMinutes: String(league.typicalGameMinutes),
    quietAfterMinutes: String(league.quietAfterMinutes),
  };
}

/** One provider league's settings (#1997), then Edit for its switch and its two lengths. */
export function ProviderLeagueDialog({ league, onClose }: { league: ProviderLeagueRow; onClose: () => void }) {
  const testId = 'root-admin-provider-league-dialog';
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const current = valuesOf(league);
  const form = useForm<LeagueValues>({ resolver: zodResolver(leagueSchema), defaultValues: current, mode: 'onChange' });
  const updateMutation = useUpdateProviderLeague({
    providerId: league.providerId,
    providerLeagueId: league.id,
    onSuccess: () => {
      showToast({ title: `Saved ${league.providerName}'s ${league.name}`, tone: 'success' });
      form.reset(form.getValues());
      setMode('view');
    },
  });

  const facts: Fact[] = [
    { id: 'provider', label: 'Provider', value: league.providerName },
    { id: 'code', label: 'Code', value: league.code },
    { id: 'sport', label: 'Sport', value: enumLabel('Sport', league.sport) },
    { id: 'enabled', label: 'Status', value: league.isEnabled ? 'On' : 'Off', testId: `${testId}-enabled` },
    { id: 'typical', label: 'Typical game', value: `${String(league.typicalGameMinutes)} minutes`, testId: `${testId}-typical` },
    { id: 'quiet', label: 'Webhook quiet', value: `${String(league.quietAfterMinutes)} minutes`, testId: `${testId}-quiet` },
  ];

  const cancelEdit = () => {
    form.reset(current);
    updateMutation.reset();
    setMode('view');
  };

  return (
    <DetailEditModal
      canSave={form.formState.isValid && form.formState.isDirty}
      error={updateMutation.error}
      errorFallback="We could not save this league."
      facts={facts}
      isPending={updateMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      onEdit={() => setMode('edit')}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => updateMutation.mutate({
        ...(values.isEnabled !== current.isEnabled && { isEnabled: values.isEnabled === 'on' }),
        ...(values.typicalGameMinutes !== current.typicalGameMinutes && { typicalGameMinutes: Number(values.typicalGameMinutes) }),
        ...(values.quietAfterMinutes !== current.quietAfterMinutes && { quietAfterMinutes: Number(values.quietAfterMinutes) }),
      }))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save league"
      testId={testId}
      title={mode === 'view' ? league.name : `${league.name} · Edit`}
    >
      <div className="grid gap-4">
        <OnOffField label="Status" registration={form.register('isEnabled')} testId={`${testId}-enabled-input`} />
        <FormField error={form.formState.errors.typicalGameMinutes?.message} label="Typical game, minutes">
          <Input data-testid={`${testId}-typical-input`} inputMode="numeric" {...form.register('typicalGameMinutes')} />
        </FormField>
        <FormField error={form.formState.errors.quietAfterMinutes?.message} label="Webhook quiet, minutes">
          <Input data-testid={`${testId}-quiet-input`} inputMode="numeric" {...form.register('quietAfterMinutes')} />
        </FormField>
      </div>
    </DetailEditModal>
  );
}
