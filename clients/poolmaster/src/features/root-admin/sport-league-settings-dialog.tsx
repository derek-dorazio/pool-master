import { zodResolver } from '@hookform/resolvers/zod';
import { AUTO_RELEASE_DAYS_MAX } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { SportLeagueDto } from '@/lib/api';
import {
  DetailEditModal,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  ReadOnlyDetailModal,
  Select,
  showToast,
  type Fact,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { usePlatformPricingProfilesQuery, usePlatformTierProfilesQuery } from './use-profiles';
import { useProvidersQuery } from './use-providers-query';
import { useSportLeagueQuery } from './use-sport-league-overviews';
import { useUpdateSportLeague } from './use-update-sport-league';

const settingsSchema = z.object({
  isActive: z.enum(['on', 'off']),
  /** The provider league whose sync keeps the league's events; empty is none. */
  syncProviderLeagueId: z.string(),
  /** Days before an event's start its automatic release begins; empty is off. */
  autoReleaseDays: z.string().refine(
    (value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= AUTO_RELEASE_DAYS_MAX),
    `Enter 1 to ${String(AUTO_RELEASE_DAYS_MAX)} days, or leave it empty for no automatic release`,
  ),
  platformTierProfileId: z.string().min(1),
  platformPricingProfileId: z.string().min(1),
});

type SettingsValues = z.infer<typeof settingsSchema>;

function valuesOf(sportLeague: SportLeagueDto): SettingsValues {
  return {
    isActive: sportLeague.isActive ? 'on' : 'off',
    syncProviderLeagueId: sportLeague.selectedProviderMapping?.providerLeagueId ?? '',
    autoReleaseDays: sportLeague.autoReleaseDaysBeforeStart === null ? '' : String(sportLeague.autoReleaseDaysBeforeStart),
    platformTierProfileId: sportLeague.platformTierProfileId,
    platformPricingProfileId: sportLeague.platformPricingProfileId,
  };
}

function autoReleaseText(days: number | null): string {
  if (days === null) return 'Off';
  return days === 1 ? '1 day before start' : `${String(days)} days before start`;
}

/**
 * A sport league's settings (the ⚙ beside its name on the Sports page, and on its own page): what
 * each is now, then Edit for a form of all of them with one Save (rules/ux-rules.md §12 item 14).
 * Only changed values are sent, so a league whose provider was unregistered can still be turned
 * off.
 */
export function SportLeagueSettingsDialog({ onClose, sportLeagueId }: { onClose: () => void; sportLeagueId: string }) {
  const sportLeagueQuery = useSportLeagueQuery(sportLeagueId);
  const testId = 'root-admin-sport-league-settings';

  if (sportLeagueQuery.data) {
    return <LoadedSettingsDialog onClose={onClose} sportLeague={sportLeagueQuery.data} />;
  }
  return (
    <ReadOnlyDetailModal
      detailContent={sportLeagueQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(sportLeagueQuery.error, { fallback: 'We could not load this sport league right now.' })}
          onRetry={() => void sportLeagueQuery.refetch()}
          size="plain"
        />
      ) : <LoadingState body="Loading sport league..." size="plain" />}
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      size="sm"
      testId={testId}
      title="Sport league settings"
    />
  );
}

function LoadedSettingsDialog({ onClose, sportLeague }: { onClose: () => void; sportLeague: SportLeagueDto }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const providersQuery = useProvidersQuery();
  const platformTierProfilesQuery = usePlatformTierProfilesQuery();
  const platformPricingProfilesQuery = usePlatformPricingProfilesQuery();
  const current = valuesOf(sportLeague);

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: current,
    mode: 'onChange',
  });

  const updateMutation = useUpdateSportLeague({
    failedAction: 'sportLeague.settings.failed',
    onSuccess: () => {
      showToast({ title: `Saved ${sportLeague.name}'s settings`, tone: 'success' });
      // The saved values are the new baseline, so Edit again with no change leaves Save off.
      form.reset(form.getValues());
      setMode('view');
    },
    refusedMessage: 'Sport league settings were refused',
    sportLeagueId: sportLeague.id,
    toBody: (values: SettingsValues) => ({
      ...(values.isActive !== current.isActive && { isActive: values.isActive === 'on' }),
      ...(values.syncProviderLeagueId !== current.syncProviderLeagueId && {
        syncProviderLeagueId: values.syncProviderLeagueId === '' ? null : values.syncProviderLeagueId,
      }),
      ...(values.autoReleaseDays !== current.autoReleaseDays && {
        autoReleaseDaysBeforeStart: values.autoReleaseDays === '' ? null : Number(values.autoReleaseDays),
      }),
      ...(values.platformTierProfileId !== current.platformTierProfileId && { platformTierProfileId: values.platformTierProfileId }),
      ...(values.platformPricingProfileId !== current.platformPricingProfileId && { platformPricingProfileId: values.platformPricingProfileId }),
    }),
  });

  // The provider leagues that play the league's sport, from the Provider rows (#1997).
  const providerLeagues = (providersQuery.data ?? []).flatMap((provider) => (provider.settings?.leagues ?? [])
    .filter((league) => league.sport === sportLeague.sport)
    .map((league) => ({ id: league.id, label: `${provider.providerName} · ${league.name}` })));
  const selected = sportLeague.selectedProviderMapping;
  const selectedLabel = selected === null ? 'No provider' : `${selected.providerName} · ${selected.providerLeagueName}`;
  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const platformTierProfileName = platformTierProfilesQuery.data?.find((profile) => profile.id === sportLeague.platformTierProfileId)?.name ?? '…';
  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const platformPricingProfileName = platformPricingProfilesQuery.data?.find((profile) => profile.id === sportLeague.platformPricingProfileId)?.name ?? '…';

  const facts: Fact[] = [
    { id: 'status', label: 'Status', value: sportLeague.isActive ? 'On' : 'Off', testId: 'root-admin-sport-league-settings-status' },
    { id: 'provider', label: 'Provider', value: selectedLabel, testId: 'root-admin-sport-league-settings-provider' },
    { id: 'autoRelease', label: 'Auto release', value: autoReleaseText(sportLeague.autoReleaseDaysBeforeStart), testId: 'root-admin-sport-league-settings-auto-release' },
    { id: 'platformTierProfile', label: 'Tier profile', value: platformTierProfileName, testId: 'root-admin-sport-league-settings-tier-profile' },
    { id: 'platformPricingProfile', label: 'Pricing profile', value: platformPricingProfileName, testId: 'root-admin-sport-league-settings-pricing-profile' },
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
      errorFallback="We could not save these settings."
      facts={facts}
      isPending={updateMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      onEdit={() => setMode('edit')}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => updateMutation.mutate(values))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save settings"
      testId="root-admin-sport-league-settings"
      title={mode === 'view' ? `${sportLeague.name} settings` : `${sportLeague.name} settings · Edit`}
    >
      <div className="grid gap-4">
        <FormField label="Status">
          <Select data-testid="root-admin-sport-league-settings-status-input" {...form.register('isActive')}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </FormField>
        <FormField label="Provider">
          <Select data-testid="root-admin-sport-league-settings-provider-input" {...form.register('syncProviderLeagueId')}>
            <option value="">No provider</option>
            {current.syncProviderLeagueId !== '' && !providerLeagues.some((league) => league.id === current.syncProviderLeagueId)
              ? <option value={current.syncProviderLeagueId}>{selectedLabel}</option>
              : null}
            {providerLeagues.map((league) => (
              <option key={league.id} value={league.id}>{league.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField error={form.formState.errors.autoReleaseDays?.message} label="Auto release, days before start">
          <Input
            data-testid="root-admin-sport-league-settings-auto-release-input"
            inputMode="numeric"
            placeholder="Off"
            {...form.register('autoReleaseDays')}
          />
        </FormField>
        <FormField label="Tier profile">
          <Select data-testid="root-admin-sport-league-settings-tier-profile-input" {...form.register('platformTierProfileId')}>
            {(platformTierProfilesQuery.data ?? []).length === 0
              ? <option value={current.platformTierProfileId}>{platformTierProfileName}</option>
              : null}
            {(platformTierProfilesQuery.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Pricing profile">
          <Select data-testid="root-admin-sport-league-settings-pricing-profile-input" {...form.register('platformPricingProfileId')}>
            {(platformPricingProfilesQuery.data ?? []).length === 0
              ? <option value={current.platformPricingProfileId}>{platformPricingProfileName}</option>
              : null}
            {(platformPricingProfilesQuery.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </Select>
        </FormField>
      </div>
    </DetailEditModal>
  );
}
