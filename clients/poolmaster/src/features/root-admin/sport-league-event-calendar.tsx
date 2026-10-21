import type { SportNoun } from '@poolmaster/shared/domain';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DataGrid, StatusBadge, formatDateTimeDisplay } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import {
  deriveSportEventReadiness,
  formatSportEventStatus,
  sportEventStatusTone,
} from './sport-admin-utils';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

const columnHelper = createColumnHelper<SportEventDto>();

/** The calendar's columns, the first named for the sport's event ("Tournament", "Race"). */
const buildCalendarColumns = (eventLabel: string) => [
  columnHelper.accessor('name', {
    header: eventLabel,
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
      const readiness = deriveSportEventReadiness(row.original);
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
export function SportLeagueEventCalendar({
  isError,
  sportLeague,
  tournaments,
}: {
  isError: boolean;
  /** What the league is called (#834), for the copy. */
  sportLeague: SportNoun;
  tournaments: SportEventDto[];
}) {
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const columns = useMemo(() => buildCalendarColumns(capitalize(event.one)), [event.one]);
  return (
    <DataGrid
      columns={columns}
      data={tournaments}
      emptyMessage={
        isError
          ? `We could not load this ${sportLeague.one}’s ${event.many} right now.`
          : `No ${event.many} are scheduled in this year yet.`
      }
      getRowId={(tournament) => tournament.id}
      getRowLink={(tournament) => buildSportEventPath(sport, tournament.id)}
      rowTestId={(tournament) => `root-admin-sport-league-event-row-${tournament.id}`}
      tableTestId="root-admin-sport-league-calendar-table"
    />
  );
}
