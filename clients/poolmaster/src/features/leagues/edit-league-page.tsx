import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { LeagueIconKey } from '@poolmaster/shared/domain';
import { updateLeagueDetails, updateLeagueIcon, type LeagueDto } from '@/lib/api';
import {
  FormField,
  FormPage,
  IconPalette,
  Input,
  Textarea,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { syncLeagueCaches } from './league-cache';
import { LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { LeagueIcon } from './league-icon';
import { buildLeagueAdminPath } from './league-routing';
import { useLeagueContext } from './use-league-context';

const editLeagueFormSchema = z.object({
  name: z.string().trim().min(1, 'League name is required').max(100, 'League name must be 100 characters or fewer'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer'),
  iconKey: z.nativeEnum(LeagueIconKey),
});

type EditLeagueFormValues = z.infer<typeof editLeagueFormSchema>;

/** Edit league: name, icon and description together, with one Save. */
export function EditLeaguePage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }

  // Keyed by the league so the draft is built once per league and a background refetch never
  // overwrites what the commissioner has typed (rules/react-ui-rules.md §5 Server Data
  // Form-State Hazard).
  return <EditLeagueForm key={league.id} league={league} />;
}

function EditLeagueForm({ league }: { league: LeagueDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsPath = buildLeagueAdminPath(league.leagueCode);
  const form = useForm<EditLeagueFormValues>({
    resolver: zodResolver(editLeagueFormSchema),
    defaultValues: {
      name: league.name,
      description: league.description ?? '',
      iconKey: league.iconKey,
    },
  });
  const iconKey = form.watch('iconKey');

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: EditLeagueFormValues) => {
      // An empty description is left out, which the contract reads as clearing it.
      const detailsResponse = await updateLeagueDetails({
        path: { id: league.id },
        body: {
          name: values.name,
          ...(values.description ? { description: values.description } : {}),
        },
      });
      if (!detailsResponse.data?.league) {
        throwApiError(detailsResponse.error, 'League details update response is missing data.');
      }
      if (values.iconKey === detailsResponse.data.league.iconKey) {
        return detailsResponse.data.league;
      }

      const iconResponse = await updateLeagueIcon({
        path: { id: league.id },
        body: { iconKey: values.iconKey },
      });
      if (!iconResponse.data?.league) {
        throwApiError(iconResponse.error, 'League icon update response is missing data.');
      }
      return iconResponse.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      navigate(settingsPath);
    },
    invalidates: [],
  });

  return (
    <FormPage
      cancelTo={settingsPath}
      description="Members see these at the top of League Home."
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the league.' })
        : null}
      isPending={saveMutation.isPending}
      onSubmit={(event) => void form.handleSubmit((values) => saveMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save league"
      submitTestId="edit-league-save"
      testId="edit-league-page"
      title="Edit league"
    >
      <FormField error={form.formState.errors.name?.message} id="edit-league-name" label="League name">
        <Input
          data-testid="edit-league-name"
          disabled={saveMutation.isPending}
          id="edit-league-name"
          type="text"
          {...form.register('name')}
        />
      </FormField>

      <FormField
        error={form.formState.errors.description?.message}
        helperText="Optional."
        id="edit-league-description"
        label="Description"
      >
        <Textarea
          data-testid="edit-league-description"
          disabled={saveMutation.isPending}
          id="edit-league-description"
          {...form.register('description')}
        />
      </FormField>

      <FormField helperText="The league code is permanent." id="edit-league-code" label="League code">
        <Input className="font-mono" id="edit-league-code" readOnly value={league.leagueCode} />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Icon</legend>
        <IconPalette
          aria-label="League icon"
          disabled={saveMutation.isPending}
          onSelect={(key) => form.setValue('iconKey', key, { shouldDirty: true })}
          optionTestIdPrefix="league-icon"
          options={LEAGUE_ICON_OPTIONS}
          renderOptionIcon={(icon) => (
            <div className="flex justify-center text-primary">
              <LeagueIcon iconKey={icon.key} size="md" />
            </div>
          )}
          testId="league-icon-palette"
          value={iconKey}
        />
      </fieldset>
    </FormPage>
  );
}
