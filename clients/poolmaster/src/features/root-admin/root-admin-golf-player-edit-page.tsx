import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { updateParticipant } from '@/lib/api';
import type { ParticipantDto, UpdateParticipantData } from '@/lib/api';
import { AsyncPage, FormField, FormPage, Input, Select } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { GOLF_PLAYER_STATUSES } from './golf-admin-utils';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { buildGolfPlayerPath } from './manage-navigation';
import { useGolfPlayerQuery } from './use-golf-catalog';

const editSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  role: z.string().trim().optional(),
  teamAffiliation: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
  status: z.enum(GOLF_PLAYER_STATUSES),
});

type EditValues = z.infer<typeof editSchema>;

function toDefaults(player: ParticipantDto): EditValues {
  return {
    name: player.name,
    firstName: player.firstName ?? '',
    lastName: player.lastName ?? '',
    shortName: player.shortName ?? '',
    nationality: player.nationality ?? '',
    role: player.role ?? '',
    teamAffiliation: player.teamAffiliation ?? '',
    externalId: player.externalId ?? '',
    status: player.status,
  };
}

function toBody(values: EditValues): UpdateParticipantData['body'] {
  return {
    name: values.name,
    firstName: values.firstName?.trim() ?? '',
    lastName: values.lastName?.trim() ?? '',
    shortName: values.shortName?.trim() ?? '',
    nationality: values.nationality?.trim() ?? '',
    role: values.role?.trim() ?? '',
    teamAffiliation: values.teamAffiliation?.trim() ?? '',
    externalId: values.externalId?.trim() ?? '',
    status: values.status,
  };
}

function GolfPlayerEditForm({ player }: { player: ParticipantDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-player-edit-page',
  });
  const navigate = useNavigate();
  const homePath = buildGolfPlayerPath(player.id);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: toDefaults(player),
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditValues) => {
      const response = await updateParticipant({
        path: { id: player.id },
        body: toBody(values),
      });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Golf player update response is missing data.');
      }
      return response.data.participant;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.player(player.id),
      QueryKeys.rootAdmin.golf.players,
    ],
    onSuccess: () => navigate(homePath),
    onError: (error) => {
      logger.warn(
        { action: 'golf.player.update.failed', err: error },
        'Golf player update was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={homePath}
      errorMessage={updateMutation.isError
        ? extractErrorMessage(updateMutation.error, { fallback: 'We could not save this golfer.' })
        : undefined}
      isPending={updateMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => updateMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save player"
      submitTestId="root-admin-golf-player-edit-save"
      testId="root-admin-golf-player-edit-page"
      title="Edit details"
    >
      <FormField error={form.formState.errors.name?.message} label="Name">
        <Input data-testid="root-admin-golf-player-edit-name" {...form.register('name')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name">
          <Input {...form.register('firstName')} />
        </FormField>
        <FormField label="Last name">
          <Input {...form.register('lastName')} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Short name">
          <Input {...form.register('shortName')} />
        </FormField>
        <FormField label="Nationality">
          <Input data-testid="root-admin-golf-player-edit-nationality" {...form.register('nationality')} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Role">
          <Input {...form.register('role')} />
        </FormField>
        <FormField label="Team affiliation">
          <Input {...form.register('teamAffiliation')} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="External ID">
          <Input {...form.register('externalId')} />
        </FormField>
        <FormField
          helperText="Removing a golfer is a status change, not a delete."
          label="Status"
        >
          <Select
            data-testid="root-admin-golf-player-edit-status"
            {...form.register('status')}
          >
            {GOLF_PLAYER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </FormPage>
  );
}

/** Edit a golfer's details and status, with one Save. */
export function RootAdminGolfPlayerEditPage() {
  const { participantId = '' } = useParams<{ participantId: string }>();
  const playerQuery = useGolfPlayerQuery(participantId);
  const player = playerQuery.data;

  useManageBreadcrumbOverride(participantId || undefined, player?.name);

  return (
    <AsyncPage
      errorBody={extractErrorMessage(playerQuery.error, {
        fallback: 'We could not load this golf player right now.',
      })}
      loadingBody="Loading golf player..."
      state={playerQuery.isLoading ? 'loading' : playerQuery.isError ? 'error' : 'ready'}
    >
      {player ? <GolfPlayerEditForm player={player} /> : null}
    </AsyncPage>
  );
}
