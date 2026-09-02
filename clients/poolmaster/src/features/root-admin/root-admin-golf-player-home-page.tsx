import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { adminGetGolfPlayer, adminUpdateGolfPlayer } from '@/lib/api';
import {
  AsyncPage,
  Button,
  DefinitionList,
  FormField,
  FormModal,
  Input,
  Select,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminGetGolfPlayerResponses, AdminUpdateGolfPlayerData } from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import { GOLF_PLAYER_STATUSES, golfPlayerStatusTone } from './golf-admin-utils';

type GolfPlayer = AdminGetGolfPlayerResponses[200]['player'];

const editSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  position: z.string().trim().optional(),
  teamAffiliation: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
  status: z.enum(GOLF_PLAYER_STATUSES),
});

type EditValues = z.infer<typeof editSchema>;

function toDefaults(player: GolfPlayer): EditValues {
  return {
    name: player.name,
    firstName: player.firstName ?? '',
    lastName: player.lastName ?? '',
    shortName: player.shortName ?? '',
    nationality: player.nationality ?? '',
    position: player.position ?? '',
    teamAffiliation: player.teamAffiliation ?? '',
    externalId: player.externalId ?? '',
    status: player.status,
  };
}

function toBody(values: EditValues): AdminUpdateGolfPlayerData['body'] {
  return {
    name: values.name,
    firstName: values.firstName?.trim() ?? '',
    lastName: values.lastName?.trim() ?? '',
    shortName: values.shortName?.trim() ?? '',
    nationality: values.nationality?.trim() ?? '',
    position: values.position?.trim() ?? '',
    teamAffiliation: values.teamAffiliation?.trim() ?? '',
    externalId: values.externalId?.trim() ?? '',
    status: values.status,
  };
}

/**
 * plans/124 §6.3 — /manage/golf/players/:participantId. The canonical player
 * page: an editable detail form (status is a change, never a delete — §4.1) plus
 * a read-only provider-mapping list.
 */
export function RootAdminGolfPlayerHomePage() {
  const { participantId = '' } = useParams<{ participantId: string }>();
  const logger = getLogger().child({
    feature: 'root-admin-golf-player-home-page',
  });
  const [editOpen, setEditOpen] = useState(false);

  const playerQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.player(participantId),
    queryFn: async (): Promise<GolfPlayer> => {
      const response = await adminGetGolfPlayer({ path: { participantId } });
      if (!response.data?.player) {
        throw response.error ?? new Error('Golf player response is missing data.');
      }
      return response.data.player;
    },
    enabled: participantId !== '',
    retry: false,
  });

  const player = playerQuery.data;
  useManageBreadcrumbOverride(participantId || undefined, player?.name);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: player
      ? toDefaults(player)
      : {
          name: '',
          firstName: '',
          lastName: '',
          shortName: '',
          nationality: '',
          position: '',
          teamAffiliation: '',
          externalId: '',
          status: 'ACTIVE',
        },
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditValues) => {
      const response = await adminUpdateGolfPlayer({
        path: { participantId },
        body: toBody(values),
      });
      if (!response.data?.player) {
        throw response.error ?? new Error('Golf player update response is missing data.');
      }
      return response.data.player;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.player(participantId),
      QueryKeys.rootAdmin.golf.players,
    ],
    onSuccess: () => setEditOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.player.update.failed', err: error },
        'Golf player update was rejected',
      );
    },
  });

  const submit = form.handleSubmit((values) => updateMutation.mutate(values));

  const pageState = playerQuery.isLoading
    ? 'loading'
    : playerQuery.isError
      ? 'error'
      : participantId === '' || !player
        ? 'empty'
        : 'ready';

  return (
    <AsyncPage
      emptyBody="This golf player does not exist or has been removed."
      emptyTitle="Player not found"
      errorBody={extractErrorMessage(playerQuery.error, {
        fallback: 'We could not load this golf player right now.',
      })}
      loadingBody="Loading golf player..."
      state={pageState}
      testId="root-admin-golf-player-home-page"
    >
      {player ? (
        <div className="space-y-6">
          <Tile>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{player.name}</h2>
                <div className="mt-2">
                  <StatusBadge tone={golfPlayerStatusTone(player.status)}>
                    {player.status}
                  </StatusBadge>
                </div>
              </div>
              <Button
                data-testid="root-admin-golf-player-home-edit"
                onClick={() => {
                  form.reset(toDefaults(player));
                  setEditOpen(true);
                }}
                size="sm"
                variant="secondary"
              >
                Edit player
              </Button>
            </div>

            <DefinitionList
              className="mt-4"
              items={[
                { id: 'first', label: 'First name', value: player.firstName || 'Not set' },
                { id: 'last', label: 'Last name', value: player.lastName || 'Not set' },
                { id: 'short', label: 'Short name', value: player.shortName || 'Not set' },
                {
                  id: 'nat',
                  label: 'Nationality',
                  value: player.nationality || 'Not set',
                },
                { id: 'pos', label: 'Position', value: player.position || 'Not set' },
                {
                  id: 'team',
                  label: 'Team affiliation',
                  value: player.teamAffiliation || 'Not set',
                },
                {
                  id: 'ext',
                  label: 'External ID',
                  value: player.externalId || 'Not set',
                },
              ]}
            />
          </Tile>

          <Tile>
            <h3 className="text-base font-semibold text-foreground">
              Provider mappings ({player.providerMappings.length})
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              How this golfer is matched in each provider&rsquo;s feed. Read-only.
            </p>
            {player.providerMappings.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No provider mappings recorded.
              </p>
            ) : (
              <ul
                className="mt-4 divide-y divide-border rounded-2xl border border-border"
                data-testid="root-admin-golf-player-home-mappings"
              >
                {player.providerMappings.map((mapping, index) => (
                  <li
                    className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
                    key={`${mapping.providerId}-${mapping.externalId}-${index}`}
                  >
                    <span className="font-medium text-foreground">
                      {mapping.providerId}
                    </span>
                    <span className="text-muted-foreground">{mapping.externalId}</span>
                    <StatusBadge tone="neutral">{mapping.confidence}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Tile>

          <FormModal
            canSave={form.formState.isValid}
            error={updateMutation.error}
            isPending={updateMutation.isPending}
            onCancel={() => setEditOpen(false)}
            onOpenChange={(next) => !next && setEditOpen(false)}
            onSave={() => {
              void submit();
            }}
            open={editOpen}
            saveLabel="Save player"
            saveTestId="root-admin-golf-player-home-edit-save"
            testId="root-admin-golf-player-home-edit-modal"
            title="Edit golf player"
          >
            <form className="space-y-3" onSubmit={submit}>
              <FormField error={form.formState.errors.name?.message} label="Name">
                <Input {...form.register('name')} />
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
                  <Input {...form.register('nationality')} />
                </FormField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Position">
                  <Input {...form.register('position')} />
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
                    data-testid="root-admin-golf-player-home-edit-status"
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
            </form>
          </FormModal>
        </div>
      ) : null}
    </AsyncPage>
  );
}
