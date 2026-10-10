import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  DataGridPage,
  FormField,
  LinkButton,
  Select,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantDto } from '@/lib/api';
import {
  GOLF_PLAYER_STATUSES,
  golfPlayerStatusTone,
  type GolfPlayerStatus,
} from './golf-admin-utils';
import {
  GOLF_PLAYER_LIST_PATH,
  MANAGE_LIST_PAGE_SIZE,
  buildGolfPlayerPath,
} from './manage-navigation';
import { useGolfPlayersQuery } from './use-golf-catalog';

const columnHelper = createColumnHelper<ParticipantDto>();

/**
 * /manage/golf/players. The master golfer roster: a searchable, paged grid of one
 * status at a time, with Add player opening its own page and rows linking to each golfer.
 */
export function RootAdminGolfPlayerListPage() {
  // One status at a time, ACTIVE first, as the golf player list this replaced did.
  // listParticipants would list every status if asked without one; the single-select
  // keeps the page's behaviour.
  const [status, setStatus] = useState<GolfPlayerStatus>('ACTIVE');

  const playersQuery = useGolfPlayersQuery({
    queryKey: QueryKeys.rootAdmin.golf.playerList(status),
    status,
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
        <LinkButton
          data-testid="root-admin-golf-player-list-new"
          to={`${GOLF_PLAYER_LIST_PATH}/new`}
        >
          Add player
        </LinkButton>
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
        getRowLink={(player) => buildGolfPlayerPath(player.id)}
        loadingBody="Loading golf players..."
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(player) => `root-admin-golf-player-row-${player.id}`}
        search={{ label: 'Find a golfer', testId: 'root-admin-golf-player-list-search' }}
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
    </div>
  );
}
