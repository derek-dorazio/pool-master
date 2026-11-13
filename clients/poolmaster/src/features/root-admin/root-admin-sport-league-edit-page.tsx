import { zodResolver } from '@hookform/resolvers/zod';
import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import type { SportLeagueDto } from '@/lib/api';
import { FormField, FormPage, Input, Select } from '@/features/shared/ui';
import { formPageSave } from '@/lib/form-page-save';
import { buildSportLeaguePath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { SportLeaguePage } from './sport-league-page';
import { useUpdateSportLeague } from './use-update-sport-league';
import { useProvidersQuery } from './use-providers-query';
import { upperFirst } from '@/lib/upper-first';

const editSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  matchKeyword: z.string().trim().optional(),
  /** The provider whose sync creates the league's events (ADR 0011); empty is off. */
  eventSyncProviderId: z.string(),
});

type EditValues = z.infer<typeof editSchema>;

function SportLeagueEditForm({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const navigate = useNavigate();
  const { sport } = useManagedSport();
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague.noun);
  const homePath = buildSportLeaguePath(sport, sportLeague.id);
  const currentSyncProviderId = sportLeague.eventSyncProviderId ?? '';

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: sportLeague.name,
      matchKeyword: sportLeague.matchKeyword ?? '',
      eventSyncProviderId: currentSyncProviderId,
    },
    mode: 'onChange',
  });

  const updateMutation = useUpdateSportLeague({
    failedAction: 'sportLeague.update.failed',
    onSuccess: () => void navigate(homePath),
    refusedMessage: 'Sport league update was rejected',
    sportLeagueId: sportLeague.id,
    // Sync is sent only when it changed, so renaming a league whose provider is no longer
    // registered is not refused for a provider the admin did not touch.
    toBody: (values: EditValues) => ({
      name: values.name,
      matchKeyword: values.matchKeyword?.trim() ?? '',
      ...(values.eventSyncProviderId !== currentSyncProviderId && {
        eventSyncProviderId: values.eventSyncProviderId === '' ? null : values.eventSyncProviderId,
      }),
    }),
  });
  // Only a provider covering the sport can sync its events; one already chosen stays listed.
  const providers = useProvidersQuery();
  // poolmaster-allow-list-lookup: the handful of registered providers is the picker's whole source
  const otherSyncProviders = (providers.data ?? []).filter((provider) =>
    provider.sportsCovered.includes(sport) && provider.providerId !== currentSyncProviderId);
  // The league's own provider is one option from the first render, named by its id until the list
  // loads (or if it fails), so the picker never shows Off for a synced league.
  // poolmaster-allow-list-lookup: the same handful of providers, already loaded for the picker
  const currentProviderName = providers.data?.find((provider) => provider.providerId === currentSyncProviderId)?.providerName
    ?? currentSyncProviderId;

  return (
    <FormPage
      cancelTo={homePath}
      {...formPageSave(form, updateMutation, `We could not save this ${sportLeagueNoun.one}.`)}
      isSubmitDisabled={!form.formState.isValid}
      pendingLabel="Saving..."
      submitLabel={`Save ${sportLeagueNoun.one}`}
      submitTestId="root-admin-sport-league-edit-save"
      testId="root-admin-sport-league-edit-page"
      title="Edit details"
    >
      <FormField error={form.formState.errors.name?.message} label={`${upperFirst(sportLeagueNoun.one)} name`}>
        <Input data-testid="root-admin-sport-league-edit-name" {...form.register('name')} />
      </FormField>
      <FormField
        helperText="A word a provider's event names carry, to filter its catalog when browsing."
        label="Match keyword"
      >
        <Input data-testid="root-admin-sport-league-edit-keyword" {...form.register('matchKeyword')} />
      </FormField>
      <FormField
        helperText="Adds the league's new events each day, as drafts to release."
        label="Event sync"
      >
        <Select data-testid="root-admin-sport-league-edit-event-sync" {...form.register('eventSyncProviderId')}>
          <option value="">Off</option>
          {currentSyncProviderId === '' ? null : <option value={currentSyncProviderId}>{currentProviderName}</option>}
          {otherSyncProviders.map((provider) => (
            <option key={provider.providerId} value={provider.providerId}>
              {provider.providerName}
            </option>
          ))}
        </Select>
      </FormField>
    </FormPage>
  );
}

/** Edit a sport league's name, match keyword and event sync, with one Save. */
export function RootAdminSportLeagueEditPage() {
  // Claimed at once, so Manage never shows its own title while the page loads.
  return <SportLeaguePage>{(sportLeague) => <SportLeagueEditForm sportLeague={sportLeague} />}</SportLeaguePage>;
}
