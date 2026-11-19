import { createColumnHelper } from '@tanstack/react-table';
import type { SyncScheduleRow } from './sync-schedule-rows';

const columnHelper = createColumnHelper<SyncScheduleRow>();

/** The Sync schedules grid's columns (#1873), each explained behind its (i). */
export const syncScheduleColumns = [
  columnHelper.accessor('sync', {
    header: 'Sync',
    meta: { info: 'Health check, Event list, Field or Live scores.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('everySeconds', {
    header: 'Every',
    meta: { info: 'How often it runs, for every sport league. Off: it does not run on a schedule.', type: { kind: 'number' } },
    cell: ({ row }) => row.original.every,
  }),
  columnHelper.accessor('whichEvents', {
    header: 'Which events',
    meta: { info: 'Which events each run covers.', type: { kind: 'text' } },
  }),
];
