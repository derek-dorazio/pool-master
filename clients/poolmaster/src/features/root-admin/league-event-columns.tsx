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
import type { SportLeagueEventOverviewDto, SportLeagueSeasonDto } from '@/lib/api';
import { formatSportEventStatus, sportEventStatusTone } from './sport-admin-utils';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { LeagueEventReleaseDate } from './league-event-release-date';

const columnHelper = createColumnHelper<SportLeagueEventOverviewDto>();

/**
 * The Season the Events grid opens on (#2003): the league's current Season when some event is in
 * it; otherwise none, so the grid never opens empty.
 */
export function defaultSeasonId(
  events: readonly Pick<SportLeagueEventOverviewDto, 'sportLeagueSeasonId'>[],
  currentSeasonId: string | null,
): string | null {
  return currentSeasonId !== null && events.some((event) => event.sportLeagueSeasonId === currentSeasonId) ? currentSeasonId : null;
}

/**
 * The League page's Events grid columns (the League page spec): every one typed, so each sorts and
 * filters from its header, and every one explained behind its (i), in domain words. Season lists
 * the league's Seasons by name, latest first, and opens on `initialSeasonId` when given.
 */
export function leagueEventColumns({
  initialSeasonId,
  onOpenSyncRun,
  seasons,
  sportUrlSegment,
}: {
  initialSeasonId: string | null;
  onOpenSyncRun: (syncRunId: string) => void;
  seasons: readonly Pick<SportLeagueSeasonDto, 'id' | 'name'>[];
  /** The league's sport's URL segment, which an issue's link to an event names. */
  sportUrlSegment: string;
}) {
  const seasonName = new Map(seasons.map((season) => [season.id, season.name]));
  return [
    columnHelper.accessor('name', {
      header: 'Event',
      meta: { info: 'The event. › opens its page.', type: { kind: 'text' } },
      cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
    }),
    columnHelper.accessor('sportLeagueSeasonId', {
      id: 'season',
      header: 'Season',
      meta: {
        info: 'The Season the event belongs to. Starts filtered to the current Season.',
        type: {
          kind: 'enum',
          values: seasons.map((season) => ({ value: season.id, label: season.name })),
          initial: initialSeasonId === null ? undefined : [initialSeasonId],
        },
      },
      cell: ({ getValue }) => seasonName.get(getValue()) ?? '',
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
        info: 'What on this event needs you: Sync (its latest field or scores sync failed), Release (held by a failed ready check). Hover a chip for the items.',
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
