import { createColumnHelper } from '@tanstack/react-table';
import { DataGrid, StatusBadge, Tile, formatDateTimeDisplay } from '@/features/shared/ui';
import type { AdminListGolfTournamentsResponses } from '@/lib/api';
import {
  deriveGolfTournamentReadiness,
  formatSportEventStatus,
  sportEventStatusTone,
} from './golf-admin-utils';

type GolfTournament =
  AdminListGolfTournamentsResponses[200]['tournaments'][number];

const columnHelper = createColumnHelper<GolfTournament>();

const calendarColumns = [
  columnHelper.accessor('name', {
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
];

/**
 * plans/124 §6.3 Season Home — the read-only calendar of one season's own
 * tournaments (earliest first), each linking to its Tournament Home.
 */
export function GolfSeasonTournamentCalendar({
  isError,
  seasonName,
  tournaments,
}: {
  isError: boolean;
  seasonName: string;
  tournaments: GolfTournament[];
}) {
  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">Tournament calendar</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Every tournament scheduled in {seasonName}, earliest first.
      </p>
      <div className="mt-4">
        <DataGrid
          columns={calendarColumns}
          data={tournaments}
          emptyMessage={
            isError
              ? 'We could not load this season’s tournaments right now.'
              : 'No tournaments have been scheduled in this season yet.'
          }
          getRowId={(tournament) => tournament.id}
          getRowLink={(tournament) => `/manage/golf/tournaments/${tournament.id}`}
          rowTestId={(tournament) =>
            `root-admin-golf-season-tournament-row-${tournament.id}`
          }
          tableTestId="root-admin-golf-season-home-tournaments-table"
        />
      </div>
    </Tile>
  );
}
