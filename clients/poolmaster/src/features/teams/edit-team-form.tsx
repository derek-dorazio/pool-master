import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { type SquadDto, updateLeagueSquad } from '@/lib/api';
import { FormPage } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { TeamFormFields } from './team-form-fields';
import { teamFormSchema, type TeamFormValues } from './team-form-schema';

/**
 * Edit team: name and icon together, saved in one request. Mount it with `key={team.id}` so the
 * draft is built once per team and a background refetch never overwrites what is being typed
 * (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
 */
export function EditTeamForm({
  leagueId,
  returnTo,
  team,
}: {
  leagueId: string;
  /** Where Cancel and a successful Save go. */
  returnTo: string;
  team: SquadDto;
}) {
  const navigate = useNavigate();
  const form = useForm<TeamFormValues>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: { name: team.name, iconKey: team.iconKey },
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: TeamFormValues) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: team.id },
        body: { name: values.name, iconKey: values.iconKey },
      });
      if (!response.data?.squad) {
        throwApiError(response.error, 'Team update response is missing data.');
      }
      return response.data.squad;
    },
    onSuccess: () => {
      navigate(returnTo);
    },
    invalidates: [QueryKeys.leagueTeams.byLeague(leagueId)],
  });

  return (
    <FormPage
      cancelTo={returnTo}
      description="The name and icon every member sees for this team."
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the team.' })
        : null}
      isPending={saveMutation.isPending}
      onSubmit={(event) => void form.handleSubmit((values) => saveMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save team"
      submitTestId="edit-team-save"
      testId="edit-team-page"
      title="Edit team"
    >
      <TeamFormFields disabled={saveMutation.isPending} form={form} idPrefix="edit-team" />
    </FormPage>
  );
}
