import { createColumnHelper } from '@tanstack/react-table';
import { StatusBadge, formatDateTimeDisplay, type DisplayPreferences } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';
import { deriveSportEventReadiness, formatSportEventStatus, sportEventStatusTone } from './sport-admin-utils';

/** The columns an event list and a sport league's calendar share. */

const columnHelper = createColumnHelper<SportEventDto>();

/** The event, named for the sport's word ("Tournament", "Race"), its venue under it; searched by both. */
export function sportEventNameColumn(eventLabel: string) {
  return columnHelper.accessor((row) => `${row.name} ${row.venue || ''}`.trim(), {
    id: 'name',
    header: eventLabel,
    cell: ({ row }) => (
      <div>
        <div className="font-medium text-foreground">{row.original.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {row.original.venue || 'Venue not set'}
        </div>
      </div>
    ),
  });
}

/** When the event starts, and its status and readiness for contests. */
export function sportEventScheduleColumns(displayPreferences: DisplayPreferences) {
  return [
    columnHelper.accessor('startDate', {
      header: 'Starts',
      cell: ({ getValue }) => formatDateTimeDisplay(getValue(), displayPreferences),
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
}
