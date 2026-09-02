import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { adminListGolfTournaments } from '@/lib/api';
import {
  DataGridPage,
  LinkButton,
  StatusBadge,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import {
  deriveGolfTournamentReadiness,
  formatSportEventStatus,
  golfSyncScopeLabel,
  golfSyncScopeTone,
  sportEventStatusTone,
  type AdminGolfTournamentSummary,
} from './golf-admin-utils';

const columnHelper = createColumnHelper<AdminGolfTournamentSummary>();

export function RootAdminGolfTournamentListPage() {
  const tournamentsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tournaments,
    queryFn: async (): Promise<AdminGolfTournamentSummary[]> => {
      const response = await adminListGolfTournaments();

      if (!response.data?.tournaments) {
        throw response.error ?? new Error('Golf tournament list response is missing data.');
      }

      return response.data.tournaments;
    },
    retry: false,
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.name} ${row.venue || ''}`.trim(), {
        id: 'tournament',
        header: 'Tournament',
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
      columnHelper.accessor('fieldCount', {
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
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LinkButton
          data-testid="root-admin-golf-tournament-list-new"
          to="/manage/golf/tournaments/new"
        >
          New tournament
        </LinkButton>
      </div>

      <DataGridPage
        columns={columns}
        data={tournamentsQuery.data ?? []}
        emptyMessage="No golf tournaments have been created yet."
        errorBody={extractErrorMessage(tournamentsQuery.error, {
          fallback: 'We could not load golf tournaments right now.',
        })}
        filterTestIdPrefix="root-admin-golf-tournament-list-filter"
        getRowId={(tournament) => tournament.id}
        getRowLink={(tournament) => `/manage/golf/tournaments/${tournament.id}`}
        loadingBody="Loading golf tournaments..."
        rowTestId={(tournament) => `root-admin-golf-tournament-row-${tournament.id}`}
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
