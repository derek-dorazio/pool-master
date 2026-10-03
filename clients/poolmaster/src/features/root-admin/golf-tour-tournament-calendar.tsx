import { createColumnHelper } from '@tanstack/react-table';
import { DataGrid, StatusBadge, formatDateTimeDisplay } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import {
  deriveGolfTournamentReadiness,
  formatSportEventStatus,
  sportEventStatusTone,
} from './golf-admin-utils';

const columnHelper = createColumnHelper<SportEventDto>();

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
 * plans/124 §6.3, reshaped by plans/147 — the read-only calendar of one tour's tournaments
 * in one event year (earliest first), each linking to its Tournament Home.
 */
export function GolfTourTournamentCalendar({
  isError,
  tournaments,
}: {
  isError: boolean;
  tournaments: SportEventDto[];
}) {
  return (
    <DataGrid
      columns={calendarColumns}
      data={tournaments}
      emptyMessage={
        isError
          ? 'We could not load this tour’s tournaments right now.'
          : 'No tournaments are scheduled in this year yet.'
      }
      getRowId={(tournament) => tournament.id}
      getRowLink={(tournament) => `/manage/golf/tournaments/${tournament.id}`}
      rowTestId={(tournament) => `root-admin-golf-tour-tournament-row-${tournament.id}`}
      tableTestId="root-admin-golf-tour-calendar-table"
    />
  );
}
