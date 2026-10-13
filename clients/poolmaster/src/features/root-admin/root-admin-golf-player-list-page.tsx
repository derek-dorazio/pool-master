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
  golfPlayerStatusLabel,
  golfPlayerStatusTone,
  type GolfPlayerStatus,
} from './golf-admin-utils';
import {
  MANAGE_LIST_PAGE_SIZE,
  buildSportParticipantListPath,
  buildSportParticipantPath,
} from './manage-navigation';
import { useGolfPlayersQuery } from './use-golf-catalog';
import { useManagedSport } from './use-managed-sport';
import { GolfSectionMenu } from './golf-section-menu';

const columnHelper = createColumnHelper<ParticipantDto>();

/**
 * /manage/sports/:sport/participants. A sport's master roster (golfers, horses): a searchable,
 * paged grid of one status at a time, with Add opening its own page and rows linking to each.
 */
export function RootAdminGolfPlayerListPage() {
  const { sport, definition } = useManagedSport();
  const { participant } = definition.vocabulary;
  // One status at a time, ACTIVE first, as the golf player list this replaced did.
  // listParticipants would list every status if asked without one; the single-select
  // keeps the page's behaviour.
  const [status, setStatus] = useState<GolfPlayerStatus>('ACTIVE');

  const playersQuery = useGolfPlayersQuery({
    sport,
    queryKey: QueryKeys.rootAdmin.golf.playerList(sport, status),
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
          <StatusBadge tone={golfPlayerStatusTone(getValue())}>
            {golfPlayerStatusLabel(getValue())}
          </StatusBadge>
        ),
      }),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <GolfSectionMenu current="participants" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField className="min-w-[12rem]" label="Status">
          <Select
            data-testid="root-admin-golf-player-list-status"
            onChange={(event) => {
              const next = GOLF_PLAYER_STATUSES.find((value) => value === event.target.value);
              if (next) {
                setStatus(next);
              }
            }}
            value={status}
          >
            {GOLF_PLAYER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {golfPlayerStatusLabel(value)}
              </option>
            ))}
          </Select>
        </FormField>
        <LinkButton
          data-testid="root-admin-golf-player-list-new"
          to={`${buildSportParticipantListPath(sport)}/new`}
        >
          {`Add ${participant.one}`}
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={playersQuery.data ?? []}
        emptyMessage={`No ${golfPlayerStatusLabel(status).toLowerCase()} ${participant.many}.`}
        errorBody={extractErrorMessage(playersQuery.error, {
          fallback: `We could not load ${participant.many} right now.`,
        })}
        filterTestIdPrefix="root-admin-golf-player-list-filter"
        getRowId={(player) => player.id}
        getRowLink={(player) => buildSportParticipantPath(sport, player.id)}
        loadingBody={`Loading ${participant.many}...`}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(player) => `root-admin-golf-player-row-${player.id}`}
        search={{ label: `Find a ${participant.one}`, testId: 'root-admin-golf-player-list-search' }}
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
