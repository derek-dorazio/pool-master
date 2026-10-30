import type { SportNoun } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { DataGrid, useDisplayPreferences, type DisplayPreferences } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { sportEventNameColumn, sportEventScheduleColumns } from './sport-event-columns';
import { useManagedSport } from './use-managed-sport';

/** The calendar's columns, the first named for the sport's event ("Tournament", "Race"). */
const buildCalendarColumns = (eventLabel: string, displayPreferences: DisplayPreferences) => [
  sportEventNameColumn(eventLabel),
  ...sportEventScheduleColumns(displayPreferences),
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
  const displayPreferences = useDisplayPreferences();
  const columns = useMemo(() => buildCalendarColumns(capitalize(event.one), displayPreferences), [event.one, displayPreferences]);
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
