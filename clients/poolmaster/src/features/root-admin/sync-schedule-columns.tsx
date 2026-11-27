import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { SYNC_SEASON_STATES, type SyncScheduleRow } from './sync-schedule-rows';

const columnHelper = createColumnHelper<SyncScheduleRow>();

const STATE_INFO = 'How often it runs for a sport league in this Season state: in season while one of its Seasons is under way, off season between them. Off: it does not run on a schedule.';

/** The Sync schedules grid's columns (#1873): the sync, its interval in each Season state (#2009), and which events it covers, each explained behind its (i). */
export const syncScheduleColumns = [
  columnHelper.accessor('sync', {
    header: 'Sync',
    meta: { info: 'Which sync: the event list, the field, or live scores and results.', type: { kind: 'text' } },
  }),
  ...SYNC_SEASON_STATES.map((state) => columnHelper.accessor((row) => row.intervals[state].seconds, {
    id: `every-${state}`,
    header: enumLabel('SyncSeasonState', state),
    meta: { info: STATE_INFO, type: { kind: 'number' } },
    cell: ({ row }) => row.original.intervals[state].label,
  })),
  columnHelper.accessor('whichEvents', {
    header: 'Which events',
    meta: { info: 'Which events each run covers.', type: { kind: 'text' } },
  }),
];
