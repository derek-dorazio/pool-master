import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { type SquadDto, updateLeagueSquad } from '@/lib/api';
import { FormField, FormPage, IconPalette, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

const editTeamFormSchema = z.object({
  name: z.string().trim().min(1, 'Team name is required'),
  iconKey: z.nativeEnum(TeamIconKey),
});

type EditTeamFormValues = z.infer<typeof editTeamFormSchema>;

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
  const form = useForm<EditTeamFormValues>({
    resolver: zodResolver(editTeamFormSchema),
    defaultValues: { name: team.name, iconKey: team.iconKey },
  });
  const iconKey = form.watch('iconKey');

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: EditTeamFormValues) => {
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
      <FormField error={form.formState.errors.name?.message} id="edit-team-name" label="Team name">
        <Input
          data-testid="edit-team-name"
          disabled={saveMutation.isPending}
          id="edit-team-name"
          type="text"
          {...form.register('name')}
        />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Icon</legend>
        <IconPalette
          aria-label="Team icon"
          disabled={saveMutation.isPending}
          onSelect={(key) => form.setValue('iconKey', key, { shouldDirty: true })}
          optionTestIdPrefix="team-icon"
          options={TEAM_ICON_OPTIONS}
          renderOptionIcon={(icon) => (
            <div className="flex justify-center">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${icon.themeClass}`}>
                <TeamIcon iconKey={icon.key} size="sm" />
              </span>
            </div>
          )}
          testId="team-icon-palette"
          value={iconKey}
        />
      </fieldset>
    </FormPage>
  );
}
