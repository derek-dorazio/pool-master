import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { updateSportLeague } from '@/lib/api';
import type { SportLeagueDto } from '@/lib/api';
import { AsyncPage, FormField, FormPage, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { buildSportLeaguePath, capitalize } from './manage-navigation';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

const editSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  matchKeyword: z.string().trim().optional(),
});

type EditValues = z.infer<typeof editSchema>;

function SportLeagueEditForm({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-league-edit-page',
  });
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { sportLeague: sportLeagueNoun } = definition.vocabulary;
  const homePath = buildSportLeaguePath(sport, sportLeague.id);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: sportLeague.name, matchKeyword: sportLeague.matchKeyword ?? '' },
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditValues) => {
      const response = await updateSportLeague({
        path: { sportLeagueId: sportLeague.id },
        body: { name: values.name, matchKeyword: values.matchKeyword?.trim() ?? '' },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league update response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: () => navigate(homePath),
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.update.failed', err: error },
        'Sport league update was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={homePath}
      errorMessage={updateMutation.isError
        ? extractErrorMessage(updateMutation.error, { fallback: `We could not save this ${sportLeagueNoun.one}.` })
        : undefined}
      isPending={updateMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => updateMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel={`Save ${sportLeagueNoun.one}`}
      submitTestId="root-admin-sport-league-edit-save"
      testId="root-admin-sport-league-edit-page"
      title="Edit details"
    >
      <FormField error={form.formState.errors.name?.message} label={`${capitalize(sportLeagueNoun.one)} name`}>
        <Input data-testid="root-admin-sport-league-edit-name" {...form.register('name')} />
      </FormField>
      <FormField
        helperText="A word a provider's event names carry, to filter its catalog when browsing."
        label="Match keyword"
      >
        <Input data-testid="root-admin-sport-league-edit-keyword" {...form.register('matchKeyword')} />
      </FormField>
    </FormPage>
  );
}

/** Edit a sport league's name and match keyword, with one Save. */
export function RootAdminSportLeagueEditPage() {
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const { sport, definition } = useManagedSport();
  const { sportLeague: sportLeagueNoun } = definition.vocabulary;
  const leaguesQuery = useSportLeaguesQuery(sport);
  const sportLeague = useMemo(
    () => leaguesQuery.data?.find((candidate) => candidate.id === leagueId),
    [leaguesQuery.data, leagueId],
  );

  useManageBreadcrumbOverride(leagueId || undefined, sportLeague?.name);

  return (
    <AsyncPage
      emptyBody={`This ${sportLeagueNoun.one} does not exist or has been removed.`}
      emptyTitle={`${capitalize(sportLeagueNoun.one)} not found`}
      errorBody={extractErrorMessage(leaguesQuery.error, {
        fallback: `We could not load this ${sportLeagueNoun.one} right now.`,
      })}
      loadingBody={`Loading ${sportLeagueNoun.one}...`}
      state={leaguesQuery.isLoading ? 'loading' : leaguesQuery.isError ? 'error' : sportLeague ? 'ready' : 'empty'}
    >
      {sportLeague ? <SportLeagueEditForm sportLeague={sportLeague} /> : null}
    </AsyncPage>
  );
}
