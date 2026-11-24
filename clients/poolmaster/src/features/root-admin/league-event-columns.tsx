import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper } from '@tanstack/react-table';
import {
  type SportEventReleaseMode,
  SportEventReleaseModeOrder,
  SportEventStatusOrder,
  SportLeagueIssueTypeOrder,
  type SportLeagueIssueType,
} from '@poolmaster/shared/domain';
import { StatusBadge, Text } from '@/features/shared/ui';
import type { SportLeagueEventOverviewDto } from '@/lib/api';
import { formatSportEventStatus, sportEventStatusTone } from './sport-admin-utils';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { LeagueEventReleaseDate } from './league-event-release-date';

const columnHelper = createColumnHelper<SportLeagueEventOverviewDto>();

/**
 * The year the Events grid opens on: the league's current event year, else this calendar year,
 * when some event is in it; otherwise no year, so the grid never opens empty.
 */
export function defaultEventYear(
  events: readonly Pick<SportLeagueEventOverviewDto, 'eventYear'>[],
  currentEventYear: number | null,
  now: Date,
): number | null {
  const year = currentEventYear ?? now.getFullYear();
  return events.some((event) => event.eventYear === year) ? year : null;
}

/**
 * The League page's Events grid columns (the League page spec): every one typed, so each sorts and
 * filters from its header, and every one explained behind its (i), in domain words. Year opens on
 * `initialYear` when given.
 */
export function leagueEventColumns({
  initialYear,
  onOpenSyncRun,
  sportUrlSegment,
}: {
  initialYear: number | null;
  onOpenSyncRun: (syncRunId: string) => void;
  /** The league's sport's URL segment, which an issue's link to an event names. */
  sportUrlSegment: string;
}) {
  return [
    columnHelper.accessor('name', {
      header: 'Event',
      meta: { info: 'The event. › opens its page.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    columnHelper.accessor((event) => String(event.eventYear), {
      id: 'year',
      header: 'Year',
      meta: {
        info: 'The season the event belongs to. Starts filtered to the current season.',
        type: { kind: 'enum', initial: initialYear === null ? undefined : [String(initialYear)] },
      },
    }),
    columnHelper.accessor('startDate', {
      header: 'Starts',
      meta: { info: 'When the event starts, in your time zone. Listed earliest first.', type: { kind: 'datetime', direction: 'both' } },
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      meta: {
        info: 'Where the event is in its life: Draft, Scheduled, Postponed, In progress, Completed or Cancelled.',
        type: { kind: 'enum', order: SportEventStatusOrder, label: formatSportEventStatus },
      },
      cell: ({ getValue }) => <StatusBadge tone={sportEventStatusTone(getValue())}>{formatSportEventStatus(getValue())}</StatusBadge>,
    }),
    columnHelper.accessor('releaseMode', {
      header: 'Release',
      meta: {
        info: 'Auto: released on its own once every ready check passes, a set number of days before it starts. Manual: you release it.',
        type: { kind: 'enum', order: SportEventReleaseModeOrder, label: (mode) => enumLabel('SportEventReleaseMode', mode as SportEventReleaseMode, { form: 'short' }) },
      },
      cell: ({ getValue }) => enumLabel('SportEventReleaseMode', getValue(), { form: 'short' }),
    }),
    columnHelper.accessor('releaseAt', {
      header: 'Release date',
      meta: {
        info: 'When it was released. Grey: when an automatic release is planned; hover it for the latest ready check and what failed.',
        type: { kind: 'datetime', direction: 'both' },
      },
      cell: ({ row }) => <LeagueEventReleaseDate event={row.original} />,
    }),
    columnHelper.accessor('fieldSize', {
      header: 'Field',
      meta: { info: 'How many participants its field holds. Blank until a field loads.', type: { kind: 'number' } },
    }),
    columnHelper.accessor((event) => event.issues.map((issue) => issue.type), {
      id: 'issues',
      header: 'Issues',
      meta: {
        info: 'What on this event needs you: Sync (its latest field or scores sync failed), Release (held by a failed ready check), Overdue (results missing well after it should have ended). Hover a chip for the items.',
        type: {
          kind: 'enum',
          manyPerCell: true,
          order: SportLeagueIssueTypeOrder,
          label: (type) => enumLabel('SportLeagueIssueType', type as SportLeagueIssueType),
        },
      },
      enableSorting: false,
      cell: ({ row }) => <SportLeagueIssueChips onOpenSyncRun={onOpenSyncRun} overview={{ ...row.original, sportUrlSegment }} />,
    }),
    columnHelper.accessor('lastSyncedAt', {
      header: 'Last synced',
      meta: { info: 'When a sync last ran on this event. Blank before any.', type: { kind: 'datetime', direction: 'past' } },
    }),
  ];
}
