import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Chip, Text, cn, type DataGridDetailRow } from '@/features/shared/ui';
import { EntryDetailsToggle } from './entry-details-toggle';
import { entryColumn, isMySquadsEntry, type BoardRow } from './leaderboard-columns';
import { ScoreboardGrid } from './leaderboard-kit';
import { useLandOnEntry, useLinkedEntry } from './use-linked-entry';
import { useOpenEntryRows } from './use-open-entry-rows';

/**
 * One row under an opened entry: a game of the current week, or a week of the season. What goes
 * under the pinned Entry column, then either a cell under each week it belongs to (`weeks`, by
 * week id) or one line across every column after Entry (`span`).
 */
export type SeasonWeeksDetail = {
  id: string;
  entry: ReactNode;
  weeks?: Partial<Record<string, ReactNode>>;
  span?: ReactNode;
  testId?: string;
};

/**
 * The pinned Entry column's width: narrow enough on a phone to leave Season and the current week
 * on screen beside it, with a long name or game cut short.
 */
const ENTRY_WIDTH = 'w-40 sm:w-auto sm:max-w-md';

/** The id of a week's column, which a detail row's cell under it is keyed by. */
function weekColumnId(weekId: string): string {
  return `week-${weekId}`;
}

/** The ▼/▲ before an entry's name that opens or closes its rows. */
function OpenToggle({ entryName, isOpen, onToggle, testId }: { entryName: string; isOpen: boolean; onToggle: () => void; testId: string }) {
  return (
    <Button
      aria-expanded={isOpen}
      aria-label={`Details for ${entryName}`}
      className="-my-1 flex-none"
      data-testid={testId}
      onClick={onToggle}
      size="xs"
      variant="icon"
    >
      <ChevronDown aria-hidden className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
    </Button>
  );
}

/**
 * A season board of entries by weeks (#1751), as pick'em and survivor show theirs: the Entry
 * column pinned at the left with each entry's place and the ▼/▲ that opens it, the board's own
 * summary columns (a season total, a status), then a column per week, newest first, the current
 * one marked live. Older weeks scroll sideways under the pinned entries. An opened entry shows
 * its rows (`details`) underneath; the viewer's own start open, and "Show all details" opens
 * every one. Searchable, a page at a time, with the "My entries" switch, as every board is.
 */
export function SeasonWeeksGrid<Row extends BoardRow, Week>({
  board,
  currentWeek,
  data,
  details,
  emptyMessage,
  summaryColumns,
  testIdPrefix,
  trailing,
  weekCell,
  weekHeading,
  weekId,
  weeks,
}: {
  board: { contestId: string; leagueCode: string; leagueId: string; mySquadId: string | null };
  /** The week the board is on, and whether it is under way, which marks its column live. */
  currentWeek: { id: string | null; isLive: boolean };
  data: Row[];
  /** An entry's rows when opened; an entry with none has no ▼. */
  details?: (row: Row) => readonly SeasonWeeksDetail[];
  emptyMessage: string;
  /** The board's columns between Entry and the weeks, such as Season. */
  summaryColumns: ColumnDef<Row>[];
  /** The prefix of the board's test ids. */
  testIdPrefix: string;
  /** The Standings title bar's trailing slot: the viewer's best place. */
  trailing?: ReactNode;
  weekCell: (row: Row, week: Week) => ReactNode;
  /** A week's column name, such as "Week 12". */
  weekHeading: (week: Week) => ReactNode;
  weekId: (week: Week) => string;
  /** The contest's weeks in its own order; the board shows them newest first. */
  weeks: readonly Week[];
}) {
  const isMine = isMySquadsEntry(board.mySquadId);
  const openRows = useOpenEntryRows(data.filter(isMine).map((row) => row.entryId));
  const detailsOf = (row: Row) => details?.(row) ?? [];
  const openableIds = data.filter((row) => detailsOf(row).length > 0).map((row) => row.entryId);
  // #1762 — an entry a link names (`?entry=`) opens its rows, once, when the board has rows for it.
  const linkedEntry = useLinkedEntry();
  const landOn = useLandOnEntry();
  const linkedId = openableIds.find((id) => id === linkedEntry.entryId) ?? null;
  landOn(linkedId, () => {
    if (linkedId !== null) {
      openRows.open(linkedId);
    }
  });
  const toggle = (entryId: string) => {
    if (entryId === linkedEntry.entryId && openRows.isOpen(entryId)) {
      linkedEntry.clear();
    }
    openRows.toggle(entryId);
  };

  const entry: ColumnDef<Row> = {
    ...entryColumn<Row>(testIdPrefix, {
      ...board,
      className: ENTRY_WIDTH,
      isMine,
      truncateName: true,
      leading: (row) => (
        <>
          <Text className="w-7 flex-none" data-testid={`${testIdPrefix}-place-${row.entryId}`} size="inherit" weight="semibold">
            {row.displayPosition ?? '—'}
          </Text>
          {detailsOf(row).length > 0 ? (
            <OpenToggle
              entryName={row.entryName}
              isOpen={openRows.isOpen(row.entryId)}
              onToggle={() => toggle(row.entryId)}
              testId={`${testIdPrefix}-toggle-${row.entryId}`}
            />
          ) : <span aria-hidden className="w-7 flex-none" />}
        </>
      ),
    }),
    meta: { pinned: 'start' },
  };
  const weekColumns = [...weeks].reverse().map((week): ColumnDef<Row> => {
    const id = weekId(week);
    return {
      id: weekColumnId(id),
      header: () => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {weekHeading(week)}
          {currentWeek.isLive && currentWeek.id === id ? (
            <Chip className="px-1.5 py-0" data-testid={`${testIdPrefix}-week-${id}-live`} tone="live">Live</Chip>
          ) : null}
        </span>
      ),
      enableSorting: false,
      cell: ({ row }) => weekCell(row.original, week),
    };
  });
  const firstAfterEntry = summaryColumns[0]?.id ?? weekColumns[0]?.id;

  const detailRows = (row: Row): DataGridDetailRow[] => (openRows.isOpen(row.entryId) ? detailsOf(row).map((detail) => ({
    id: detail.id,
    testId: detail.testId,
    cells: {
      entry: <span className={cn('block min-w-0 overflow-hidden pl-14', ENTRY_WIDTH)}>{detail.entry}</span>,
      ...Object.fromEntries(Object.entries(detail.weeks ?? {}).map(([id, cell]) => [weekColumnId(id), cell])),
    },
    span: detail.span !== undefined && firstAfterEntry ? { fromColumnId: firstAfterEntry, content: detail.span } : undefined,
  })) : []);

  return (
    <ScoreboardGrid
      columns={[entry, ...summaryColumns, ...weekColumns]}
      data={data}
      detailRows={detailRows}
      emptyMessage={emptyMessage}
      isMine={isMine}
      rowTestIdPrefix={`${testIdPrefix}-row`}
      tableTestId={`${testIdPrefix}-table`}
      toolbarActions={openableIds.length > 0 ? (
        <EntryDetailsToggle
          allOpen={openRows.allOpen(openableIds)}
          onToggle={(open) => openRows.setAll(openableIds, open)}
          testId={`${testIdPrefix}-toggle-all`}
        />
      ) : undefined}
      trailing={trailing}
    />
  );
}
