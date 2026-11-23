import { enumLabel } from '@poolmaster/shared/display-strings';
import { createColumnHelper, type Row, type SortingFn } from '@tanstack/react-table';
import {
  getSportDefinition,
  SportLeagueIssueTypeOrder,
  type SportLeagueIssueType,
  SportLeagueKind,
  SportLeagueKindOrder,
  SportLeagueSyncHealthOrder,
  type SportLeagueSyncHealth,
  SportOrder,
  type Sport,
} from '@poolmaster/shared/domain';
import { Settings } from 'lucide-react';
import { Button, Text, type DateRangeValue } from '@/features/shared/ui';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { OnOffChip } from './on-off-chip';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { SyncHealthChip } from './sync-health-chip';

const columnHelper = createColumnHelper<SportLeagueOverviewDto>();

/** The Status column's values: a league is On (offered and synced) or Off. */
export const LEAGUE_STATUS = { ON: 'ON', OFF: 'OFF' } as const;
const LEAGUE_STATUS_OPTIONS = [
  { value: LEAGUE_STATUS.ON, label: 'On' },
  { value: LEAGUE_STATUS.OFF, label: 'Off' },
];

/** The words a sport league's Provider cell shows: its provider, its parent's for a Clutch Card, or none. */
export function providerText(
  overview: Pick<SportLeagueOverviewDto, 'kind' | 'parentSportLeagueId' | 'providerId'>,
  nameOfLeague: (sportLeagueId: string) => string | undefined,
  nameOfProvider: (providerId: string) => string,
): string {
  if (overview.kind === SportLeagueKind.CLUTCH_CARD && overview.parentSportLeagueId !== null) {
    const parentName = nameOfLeague(overview.parentSportLeagueId);
    if (parentName !== undefined) return `via ${parentName}`;
  }
  return overview.providerId === null ? 'No provider' : nameOfProvider(overview.providerId);
}

/**
 * Whether a row is the first of its sport among the rows shown, so its Sport cell names the sport
 * and the sports read as groups whatever the filter or sort.
 */
export function isFirstOfSport(rows: readonly Row<SportLeagueOverviewDto>[], row: Row<SportLeagueOverviewDto>): boolean {
  return firstOfSportIds(rows).has(row.id);
}

/** The ids of each sport's first row, worked out once per row model rather than once per cell. */
const firstOfSportCache = new WeakMap<readonly Row<SportLeagueOverviewDto>[], ReadonlySet<string>>();

function firstOfSportIds(rows: readonly Row<SportLeagueOverviewDto>[]): ReadonlySet<string> {
  const cached = firstOfSportCache.get(rows);
  if (cached) return cached;
  const ids = new Set(rows.filter((row, index) => index === 0 || rows[index - 1].original.sport !== row.original.sport).map((row) => row.id));
  firstOfSportCache.set(rows, ids);
  return ids;
}

function totalIssues(overview: SportLeagueOverviewDto): number {
  return overview.issues.reduce((total, issue) => total + issue.count, 0);
}

/** Issues sort by how many items there are in all, so the most to fix comes first descending. */
const byTotalIssues: SortingFn<SportLeagueOverviewDto> = (left, right) => totalIssues(left.original) - totalIssues(right.original);

/**
 * The Sports page's columns (the spec's Columns table): every one typed, so each sorts and filters
 * from its header, and every one explained behind its (i), in domain words.
 */
export function sportLeagueOverviewColumns({
  nameOfLeague,
  nameOfProvider,
  onOpenSettings,
  onOpenSyncRun,
}: {
  nameOfLeague: (sportLeagueId: string) => string | undefined;
  nameOfProvider: (providerId: string) => string;
  onOpenSettings: (sportLeagueId: string) => void;
  onOpenSyncRun: (syncRunId: string) => void;
}) {
  return [
    columnHelper.accessor('sport', {
      header: 'Sport',
      meta: {
        info: "The sport. Shown on each sport's first row; sorts in the sport's fixed order, most popular first.",
        type: { kind: 'enum', order: SportOrder, label: (sport) => getSportDefinition(sport as Sport).name },
      },
      cell: ({ row, table }) => (isFirstOfSport(table.getRowModel().rows, row)
        ? <Text variant="strong" weight="semibold">{getSportDefinition(row.original.sport).name}</Text>
        : null),
    }),
    columnHelper.accessor('name', {
      header: 'Sport league',
      meta: {
        info: 'The real-world league or tour. A Clutch Card league sits indented under the league it draws from. ⚙ opens its settings.',
        type: { kind: 'text' },
      },
      cell: ({ row }) => (
        <span className={row.original.parentSportLeagueId === null ? 'inline-flex items-center gap-2' : 'inline-flex items-center gap-2 pl-6'}>
          {row.original.parentSportLeagueId === null ? null : <Text aria-hidden tone="muted">└</Text>}
          <Text variant="strong">{row.original.name}</Text>
          <Button
            aria-label={`${row.original.name} settings`}
            data-testid={`root-admin-sports-settings-${row.original.id}`}
            onClick={() => onOpenSettings(row.original.id)}
            size="xs"
            variant="icon"
          >
            <Settings aria-hidden size={14} />
          </Button>
        </span>
      ),
    }),
    columnHelper.accessor('kind', {
      header: 'Kind',
      meta: {
        info: "Real: a sport league with its own feed. Clutch Card: a stat-pool league built from its parent league's rounds.",
        type: { kind: 'enum', order: SportLeagueKindOrder, label: (kind) => enumLabel('SportLeagueKind', kind as SportLeagueKind) },
      },
      cell: ({ getValue }) => enumLabel('SportLeagueKind', getValue()),
    }),
    columnHelper.accessor((overview) => providerText(overview, nameOfLeague, nameOfProvider), {
      id: 'provider',
      header: 'Provider',
      meta: {
        info: 'Where this sport league\'s data comes from. "via MLB" means it reads the parent league\'s feed.',
        type: { kind: 'enum' },
      },
    }),
    columnHelper.accessor('syncHealth', {
      header: 'Sync health',
      meta: {
        info: 'OK: the last run of every sync (event list, field, live scores and results) worked. ERROR: at least one failed; Issues says which. NOT RUN YET: on, but no run so far. OFF: the league is off or has no provider.',
        type: { kind: 'enum', order: SportLeagueSyncHealthOrder, label: (health) => enumLabel('SportLeagueSyncHealth', health as SportLeagueSyncHealth) },
      },
      cell: ({ getValue }) => <SyncHealthChip health={getValue()} />,
    }),
    columnHelper.accessor((overview) => overview.issues.map((issue) => issue.type), {
      id: 'issues',
      header: 'Issues',
      meta: {
        info: 'What on this sport league needs you, one chip per type with a count: Sync (failed syncs), Release (held by a failed ready check), Overdue (results missing well after it should have ended). Hover a chip for the items.',
        type: {
          kind: 'enum',
          manyPerCell: true,
          order: SportLeagueIssueTypeOrder,
          label: (type) => enumLabel('SportLeagueIssueType', type as SportLeagueIssueType),
        },
      },
      sortingFn: byTotalIssues,
      cell: ({ row }) => <SportLeagueIssueChips onOpenSyncRun={onOpenSyncRun} overview={row.original} />,
    }),
    columnHelper.accessor((overview): DateRangeValue | null => overview.season, {
      id: 'season',
      header: 'Season',
      meta: {
        info: 'First to last event of the current season, or the next season between seasons. A Clutch Card uses its parent league\'s rounds. Filters by overlap: "active in April" finds every season running in April.',
        type: { kind: 'dateRange', direction: 'both' },
      },
    }),
    columnHelper.accessor('nextEventStartsAt', {
      header: 'Next event',
      meta: {
        info: 'Start date of the next event that has not started. Blank when none, such as while a season-long event is live.',
        type: { kind: 'date', direction: 'future' },
      },
    }),
    columnHelper.accessor('eventCount', {
      header: 'Events',
      meta: {
        info: 'Events this sport league holds, past and upcoming.',
        type: { kind: 'number' },
      },
    }),
    columnHelper.accessor((overview) => (overview.isActive ? LEAGUE_STATUS.ON : LEAGUE_STATUS.OFF), {
      id: 'status',
      header: 'Status',
      meta: {
        info: 'On: offered to customers and synced. Off: hidden and not synced. Starts filtered to On.',
        type: { kind: 'enum', values: LEAGUE_STATUS_OPTIONS, initial: [LEAGUE_STATUS.ON] },
      },
      cell: ({ getValue }) => <OnOffChip on={getValue() === LEAGUE_STATUS.ON} />,
    }),
  ];
}
