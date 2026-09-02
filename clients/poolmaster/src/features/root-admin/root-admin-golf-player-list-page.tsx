import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminCreateGolfPlayer, adminListGolfPlayers } from '@/lib/api';
import {
  Button,
  DataGridPage,
  FormField,
  FormModal,
  Input,
  Select,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfPlayersResponses } from '@/lib/api';
import {
  GOLF_PLAYER_STATUSES,
  golfPlayerStatusTone,
  type GolfPlayerStatus,
} from './golf-admin-utils';

type GolfPlayer = AdminListGolfPlayersResponses[200]['players'][number];

const columnHelper = createColumnHelper<GolfPlayer>();

const newPlayerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
});

type NewPlayerValues = z.infer<typeof newPlayerSchema>;

/**
 * plans/124 §6.3 — /manage/golf/players. The master golfer roster: a read-only
 * DataGrid + an "Add player" FormModal, rows linking to Player Home.
 */
export function RootAdminGolfPlayerListPage() {
  const logger = getLogger().child({
    feature: 'root-admin-golf-player-list-page',
  });
  const [createOpen, setCreateOpen] = useState(false);
  // adminListGolfPlayers returns one status at a time (defaulting to ACTIVE), so
  // the filter is a required single-select; there is no combined "all statuses"
  // view without a backend change.
  const [status, setStatus] = useState<GolfPlayerStatus>('ACTIVE');

  const playersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.playerList(status),
    queryFn: async (): Promise<GolfPlayer[]> => {
      const response = await adminListGolfPlayers({ query: { status } });
      if (!response.data?.players) {
        throw response.error ?? new Error('Golf player list response is missing data.');
      }
      return response.data.players;
    },
    retry: false,
  });

  const form = useForm<NewPlayerValues>({
    resolver: zodResolver(newPlayerSchema),
    defaultValues: { name: '', shortName: '', nationality: '', externalId: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewPlayerValues) => {
      const response = await adminCreateGolfPlayer({
        body: {
          name: values.name,
          ...(values.shortName?.trim() ? { shortName: values.shortName.trim() } : {}),
          ...(values.nationality?.trim()
            ? { nationality: values.nationality.trim() }
            : {}),
          ...(values.externalId?.trim() ? { externalId: values.externalId.trim() } : {}),
        },
      });
      if (!response.data?.player) {
        throw response.error ?? new Error('Golf player creation response is missing data.');
      }
      return response.data.player;
    },
    invalidates: [QueryKeys.rootAdmin.golf.players],
    onSuccess: () => {
      setCreateOpen(false);
      form.reset({ name: '', shortName: '', nationality: '', externalId: '' });
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.player.create.failed', err: error },
        'Golf player creation was rejected',
      );
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('shortName', {
        header: 'Short name',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('nationality', {
        header: 'Nationality',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge tone={golfPlayerStatusTone(getValue())}>{getValue()}</StatusBadge>
        ),
      }),
      columnHelper.accessor('providerMappingCount', {
        header: 'Provider mappings',
        cell: ({ getValue }) => getValue(),
      }),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField className="min-w-[12rem]" label="Status">
          <Select
            data-testid="root-admin-golf-player-list-status"
            onChange={(event) => setStatus(event.target.value as GolfPlayerStatus)}
            value={status}
          >
            {GOLF_PLAYER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          data-testid="root-admin-golf-player-list-new"
          onClick={() => {
            form.reset({ name: '', shortName: '', nationality: '', externalId: '' });
            setCreateOpen(true);
          }}
        >
          Add player
        </Button>
      </div>

      <DataGridPage
        columns={columns}
        data={playersQuery.data ?? []}
        emptyMessage={`No ${status.toLowerCase()} golf players.`}
        errorBody={extractErrorMessage(playersQuery.error, {
          fallback: 'We could not load golf players right now.',
        })}
        filterTestIdPrefix="root-admin-golf-player-list-filter"
        getRowId={(player) => player.id}
        getRowLink={(player) => `/manage/golf/players/${player.id}`}
        loadingBody="Loading golf players..."
        rowTestId={(player) => `root-admin-golf-player-row-${player.id}`}
        state={
          playersQuery.isLoading
            ? 'loading'
            : playersQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-golf-player-list-table"
        testId="root-admin-golf-player-list-page"
      />

      <FormModal
        canSave={form.formState.isValid}
        error={createMutation.error}
        isPending={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOpenChange={(next) => !next && setCreateOpen(false)}
        onSave={() => {
          void form.handleSubmit((values) => createMutation.mutate(values))();
        }}
        open={createOpen}
        saveLabel="Add player"
        saveTestId="root-admin-golf-player-list-new-save"
        testId="root-admin-golf-player-list-new-modal"
        title="Add golf player"
      >
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <FormField error={form.formState.errors.name?.message} label="Name">
            <Input
              data-testid="root-admin-golf-player-list-new-name"
              placeholder="Rory McIlroy"
              {...form.register('name')}
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Short name">
              <Input placeholder="R. McIlroy" {...form.register('shortName')} />
            </FormField>
            <FormField label="Nationality">
              <Input placeholder="NIR" {...form.register('nationality')} />
            </FormField>
          </div>
          <FormField
            helperText="Optional. The provider's identifier for this golfer, if known."
            label="External ID"
          >
            <Input {...form.register('externalId')} />
          </FormField>
        </form>
      </FormModal>
    </div>
  );
}
