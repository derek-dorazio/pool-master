import { zodResolver } from '@hookform/resolvers/zod';
import { AUTO_RELEASE_DAYS_MAX, isClutchCardLeague } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { SportLeagueDto } from '@/lib/api';
import {
  DetailEditModal,
  ErrorState,
  FormField,
  HelpTip,
  Input,
  LoadingState,
  ReadOnlyDetailModal,
  Select,
  showToast,
  type Fact,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { usePricingProfilesQuery, useTierProfilesQuery } from './use-profiles';
import { useProvidersQuery } from './use-providers-query';
import { useSportLeagueQuery } from './use-sport-league-overviews';
import { useUpdateSportLeague } from './use-update-sport-league';

const settingsSchema = z.object({
  isActive: z.enum(['on', 'off']),
  /** The provider whose sync keeps the league's events; empty is none. */
  eventSyncProviderId: z.string(),
  /** Days before an event's start its automatic release begins; empty is off. */
  autoReleaseDays: z.string().refine(
    (value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= AUTO_RELEASE_DAYS_MAX),
    `Enter 1 to ${String(AUTO_RELEASE_DAYS_MAX)} days, or leave it empty for no automatic release`,
  ),
  tierProfileId: z.string().min(1),
  pricingProfileId: z.string().min(1),
});

type SettingsValues = z.infer<typeof settingsSchema>;

function valuesOf(sportLeague: SportLeagueDto): SettingsValues {
  return {
    isActive: sportLeague.isActive ? 'on' : 'off',
    eventSyncProviderId: sportLeague.eventSyncProviderId ?? '',
    autoReleaseDays: sportLeague.autoReleaseDaysBeforeStart === null ? '' : String(sportLeague.autoReleaseDaysBeforeStart),
    tierProfileId: sportLeague.tierProfileId,
    pricingProfileId: sportLeague.pricingProfileId,
  };
}

/**
 * A Clutch Card follows its parent league's sync: the parent's provider keeps its events, so its
 * own Provider is shown, locked, as the parent's rather than offered as a choice of its own.
 */
function followsParent(sportLeague: SportLeagueDto): boolean {
  return isClutchCardLeague(sportLeague) && sportLeague.parentSportLeagueId !== null;
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
  const tierProfilesQuery = useTierProfilesQuery();
  const pricingProfilesQuery = usePricingProfilesQuery();
  const current = valuesOf(sportLeague);
  const providerLocked = followsParent(sportLeague);
  const parentQuery = useSportLeagueQuery(providerLocked ? sportLeague.parentSportLeagueId : null);

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
      ...(values.eventSyncProviderId !== current.eventSyncProviderId && {
        eventSyncProviderId: values.eventSyncProviderId === '' ? null : values.eventSyncProviderId,
      }),
      ...(values.autoReleaseDays !== current.autoReleaseDays && {
        autoReleaseDaysBeforeStart: values.autoReleaseDays === '' ? null : Number(values.autoReleaseDays),
      }),
      ...(values.tierProfileId !== current.tierProfileId && { tierProfileId: values.tierProfileId }),
      ...(values.pricingProfileId !== current.pricingProfileId && { pricingProfileId: values.pricingProfileId }),
    }),
  });

  // poolmaster-allow-list-lookup: the handful of registered providers is the picker's whole source
  const providers = (providersQuery.data ?? []).filter((provider) =>
    provider.sportsCovered.includes(sportLeague.sport) || provider.providerId === current.eventSyncProviderId);
  const providerName = (providerId: string) =>
    // poolmaster-allow-list-lookup: the same handful of providers
    providersQuery.data?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const tierProfileName = tierProfilesQuery.data?.find((profile) => profile.id === sportLeague.tierProfileId)?.name ?? '…';
  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const pricingProfileName = pricingProfilesQuery.data?.find((profile) => profile.id === sportLeague.pricingProfileId)?.name ?? '…';

  const parent = parentQuery.data;
  const parentName = parent?.name ?? 'its parent league';
  const followsText = parent === undefined
    ? 'Follows its parent league'
    : `Follows ${parent.name} (${parent.eventSyncProviderId === null ? 'No provider' : providerName(parent.eventSyncProviderId)})`;
  const followsHelp = `${sportLeague.name} is a Clutch Card, so it follows ${parentName}'s sync and its provider. Change the provider on ${parentName}.`;

  const facts: Fact[] = [
    { id: 'status', label: 'Status', value: sportLeague.isActive ? 'On' : 'Off', testId: 'root-admin-sport-league-settings-status' },
    providerLocked
      ? {
          id: 'provider',
          label: (
            <span className="inline-flex items-center gap-1.5">
              Provider
              <HelpTip label="About Provider" testId="root-admin-sport-league-settings-provider-help">{followsHelp}</HelpTip>
            </span>
          ),
          value: followsText,
          testId: 'root-admin-sport-league-settings-provider',
        }
      : { id: 'provider', label: 'Provider', value: sportLeague.eventSyncProviderId === null ? 'No provider' : providerName(sportLeague.eventSyncProviderId), testId: 'root-admin-sport-league-settings-provider' },
    { id: 'autoRelease', label: 'Auto release', value: autoReleaseText(sportLeague.autoReleaseDaysBeforeStart), testId: 'root-admin-sport-league-settings-auto-release' },
    { id: 'tierProfile', label: 'Tier profile', value: tierProfileName, testId: 'root-admin-sport-league-settings-tier-profile' },
    { id: 'pricingProfile', label: 'Pricing profile', value: pricingProfileName, testId: 'root-admin-sport-league-settings-pricing-profile' },
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
        {providerLocked ? (
          <FormField help={followsHelp} id="root-admin-sport-league-settings-provider-input" label="Provider">
            <Select data-testid="root-admin-sport-league-settings-provider-input" disabled value="">
              <option value="">{followsText}</option>
            </Select>
          </FormField>
        ) : (
          <FormField label="Provider">
            <Select data-testid="root-admin-sport-league-settings-provider-input" {...form.register('eventSyncProviderId')}>
              <option value="">No provider</option>
              {current.eventSyncProviderId !== '' && !providers.some((provider) => provider.providerId === current.eventSyncProviderId)
                ? <option value={current.eventSyncProviderId}>{current.eventSyncProviderId}</option>
                : null}
              {providers.map((provider) => (
                <option key={provider.providerId} value={provider.providerId}>{provider.providerName}</option>
              ))}
            </Select>
          </FormField>
        )}
        <FormField error={form.formState.errors.autoReleaseDays?.message} label="Auto release, days before start">
          <Input
            data-testid="root-admin-sport-league-settings-auto-release-input"
            inputMode="numeric"
            placeholder="Off"
            {...form.register('autoReleaseDays')}
          />
        </FormField>
        <FormField label="Tier profile">
          <Select data-testid="root-admin-sport-league-settings-tier-profile-input" {...form.register('tierProfileId')}>
            {(tierProfilesQuery.data ?? []).length === 0
              ? <option value={current.tierProfileId}>{tierProfileName}</option>
              : null}
            {(tierProfilesQuery.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Pricing profile">
          <Select data-testid="root-admin-sport-league-settings-pricing-profile-input" {...form.register('pricingProfileId')}>
            {(pricingProfilesQuery.data ?? []).length === 0
              ? <option value={current.pricingProfileId}>{pricingProfileName}</option>
              : null}
            {(pricingProfilesQuery.data ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </Select>
        </FormField>
      </div>
    </DetailEditModal>
  );
}
