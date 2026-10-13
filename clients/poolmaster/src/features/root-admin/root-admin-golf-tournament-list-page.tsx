import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { listEvents } from '@/lib/api';
import {
  DataGridPage,
  LinkButton,
  StatusBadge,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import {
  deriveGolfTournamentReadiness,
  formatSportEventStatus,
  golfSyncScopeLabel,
  golfSyncScopeTone,
  sportEventStatusTone,
} from './golf-admin-utils';
import type { SportEventDto } from '@/lib/api';
import {
  buildSportEventListPath,
  buildSportEventPath,
  capitalize,
  MANAGE_LIST_PAGE_SIZE,
} from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { GolfSectionMenu } from './golf-section-menu';

const columnHelper = createColumnHelper<SportEventDto>();

export function RootAdminGolfTournamentListPage() {
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportName = definition.name.toLowerCase();
  const tournamentsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.sportTournaments(sport),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport } });

      if (!response.data?.events) {
        throwApiError(response.error, `The ${sportName} ${event.one} list response is missing data.`);
      }

      return response.data.events;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.name} ${row.venue || ''}`.trim(), {
        id: 'tournament',
        header: capitalize(event.one),
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.original.venue || 'Venue not set'}
            </div>
          </div>
        ),
      }),
      columnHelper.accessor('syncScope', {
        header: 'Sync',
        cell: ({ getValue }) => (
          <StatusBadge tone={golfSyncScopeTone(getValue())}>
            {golfSyncScopeLabel(getValue())}
          </StatusBadge>
        ),
      }),
      columnHelper.accessor('startDate', {
        header: 'Starts',
        cell: ({ getValue }) => formatDateTimeDisplay(getValue()),
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge tone={sportEventStatusTone(getValue())}>
            {formatSportEventStatus(getValue())}
          </StatusBadge>
        ),
      }),
      columnHelper.display({
        id: 'readiness',
        header: 'Readiness',
        cell: ({ row }) => {
          const readiness = deriveGolfTournamentReadiness(row.original);
          return (
            <div>
              <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
              {readiness.reasons.length ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {readiness.reasons.join(', ')}
                </div>
              ) : null}
            </div>
          );
        },
        enableColumnFilter: false,
        enableSorting: false,
      }),
      columnHelper.accessor('loadedParticipantCount', {
        header: 'Field',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('tierCount', {
        header: 'Tiers',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('contestCount', {
        header: 'Contests',
        cell: ({ getValue }) => getValue(),
      }),
    ],
    [event.one],
  );

  return (
    <div className="space-y-4">
      <GolfSectionMenu current="events" />
      <div className="flex justify-end">
        <LinkButton
          data-testid="root-admin-golf-tournament-list-new"
          to={`${buildSportEventListPath(sport)}/new`}
        >
          New {event.one}
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={tournamentsQuery.data ?? []}
        emptyMessage={`No ${sportName} ${event.many} have been created yet.`}
        errorBody={extractErrorMessage(tournamentsQuery.error, {
          fallback: `We could not load ${sportName} ${event.many} right now.`,
        })}
        filterTestIdPrefix="root-admin-golf-tournament-list-filter"
        getRowId={(tournament) => tournament.id}
        getRowLink={(tournament) => buildSportEventPath(sport, tournament.id)}
        loadingBody={`Loading ${sportName} ${event.many}...`}
        pageSize={MANAGE_LIST_PAGE_SIZE}
        rowTestId={(tournament) => `root-admin-golf-tournament-row-${tournament.id}`}
        search={{ label: `Find a ${event.one}`, testId: 'root-admin-golf-tournament-list-search' }}
        state={
          tournamentsQuery.isLoading
            ? 'loading'
            : tournamentsQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-golf-tournament-list-table"
        testId="root-admin-golf-tournament-list-page"
      />
    </div>
  );
}
