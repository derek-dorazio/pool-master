import { zodResolver } from '@hookform/resolvers/zod';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { useForm } from 'react-hook-form';
import { createLeagueSquad } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { buildLeaguePath } from '@/features/leagues/league-routing';
import { FormPage } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildDefaultTeamName } from './team-defaults';
import { TeamFormFields } from './team-form-fields';
import { teamFormSchema, type TeamFormValues } from './team-form-schema';

/**
 * Create team: for a member who has no team yet in this league (a commissioner who just created
 * the league). Saving refreshes the league context, which names the viewer's new team, so My team
 * then shows it.
 */
export function CreateTeamForm({
  isInactiveLeague,
  leagueCode,
  leagueId,
}: {
  isInactiveLeague: boolean;
  leagueCode: string;
  leagueId: string;
}) {
  const auth = useAuth();
  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName),
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    },
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: TeamFormValues) => {
      const response = await createLeagueSquad({
        path: { id: leagueId },
        body: { name: values.name, iconKey: values.iconKey },
      });
      if (!response.data?.squad) {
        throwApiError(response.error, 'Team creation response is missing data.');
      }
      return response.data.squad;
    },
    invalidates: [QueryKeys.leagueTeams.byLeague(leagueId), QueryKeys.leagues.detail(leagueCode)],
  });

  return (
    <FormPage
      cancelTo={buildLeaguePath(leagueCode)}
      description="Every league member plays as a team. Pick a name and an icon; you can change both later."
      errorMessage={createMutation.isError
        ? extractErrorMessage(createMutation.error, { fallback: 'We could not create your team.' })
        : null}
      isPending={createMutation.isPending}
      isSubmitDisabled={isInactiveLeague}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Creating..."
      submitLabel="Create team"
      submitTestId="create-team-save"
      testId="create-team-page"
      title="Create your team"
    >
      <TeamFormFields
        disabled={isInactiveLeague || createMutation.isPending}
        form={form}
        idPrefix="create-team"
      />
    </FormPage>
  );
}
