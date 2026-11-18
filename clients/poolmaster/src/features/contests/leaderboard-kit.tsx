import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { ContestFormat, ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { Chip, DataGrid, DetailsPeek, PeekCard, SectionCard, Text, WinnersBanner, formatDateTimeDisplay, useDisplayPreferences, type DataGridDetailRow } from '@/features/shared/ui';
import { formatPoints } from './bracket-layout';
import { ContestPageFrame } from './contest-header';
import { ContestStatusBadge } from './contest-status-badge';
import { describeFinalStandings, type FinalRow } from './final-standings';
import { contestSchedule } from './use-contest-schedule';
import { SETTLED_NOTE, type BoardRow } from './leaderboard-columns';
import { MyEntriesToggle } from './my-entries-toggle';
import { useLinkedEntry } from './use-linked-entry';
import { narrowToMyEntries, useMyEntriesFilter } from './use-my-entries-filter';

/**
 * The pieces every contest leaderboard is built from (#1277): the frame with its notes and the
 * scoreboard grid, with the Place, Entry and total columns in `leaderboard-columns` and the
 * marker on the viewer's own rows in `mine-marker`. A scoring family's board defines only its
 * own columns and notes.
 */

/**
 * The one frame every leaderboard format's standings sit in (#1578): a section titled
 * Standings, with the viewer's best place in its title
 * bar. It is bare, a title and rule with no box, because the board is the page's long content:
 * a box's padding would cost a phone's board 32px of its width.
 */
export function LeaderboardSection({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <SectionCard bare testId="contest-leaderboard-card" title="Standings" trailing={trailing}>
      {children}
    </SectionCard>
  );
}

/**
 * A board's standings: the scoreboard grid in the Leaderboard section, searchable by entry, a
 * page at a time, with the "My entries" switch (#1750) while the viewer has an entry on it. With
 * the switch on, the rows are the viewer's alone, each still at its real place. An entry a link
 * names (`?entry=`, #1762) is turned to, highlighted and scrolled into view when the board shows it.
 */
export function ScoreboardGrid<Row extends BoardRow>({
  columns,
  data,
  detailRows,
  emptyMessage,
  isMine,
  rowTestIdPrefix,
  tableTestId,
  toolbarActions,
  trailing,
}: {
  columns: ColumnDef<Row>[];
  data: Row[];
  /** The rows under each opened entry, such as its games (`DataGrid`'s `detailRows`). */
  detailRows?: (row: Row) => readonly DataGridDetailRow[];
  emptyMessage: string;
  /** Whether a row is one of the viewer's entries, as the Entry column marks them. */
  isMine: (row: Row) => boolean;
  rowTestIdPrefix: string;
  tableTestId: string;
  /** The board's own buttons at the toolbar's end, after the "My entries" switch, such as "Show all details". */
  toolbarActions?: ReactNode;
  /** The title bar's trailing slot: the viewer's best place (`YourBestNote`). */
  trailing?: ReactNode;
}) {
  const myEntriesFilter = useMyEntriesFilter();
  const myEntries = narrowToMyEntries(data, isMine, myEntriesFilter.isOn);
  const linkedEntry = useLinkedEntry();
  return (
    <LeaderboardSection trailing={trailing}>
      <DataGrid
        headerTone="scoreboard"
        columns={columns}
        data={myEntries.rows}
        emptyMessage={emptyMessage}
        getRowId={(row) => row.entryId}
        landOnRowId={linkedEntry.entryId}
        rowTestId={(row) => `${rowTestIdPrefix}-${row.entryId}`}
        search={{ label: 'Find an entry', placeholder: 'Find an entry', testId: 'contest-leaderboard-search' }}
        showColumnFilters={false}
        // Flipping the filter starts the board again from its first page, as the lineup board does.
        tableTestId={tableTestId}
        detailRows={detailRows}
        toolbarEnd={myEntries.hasMine || toolbarActions ? (
          <span className="flex flex-wrap items-center gap-3">
            {myEntries.hasMine ? <MyEntriesToggle checked={myEntries.showsMineOnly} onCheckedChange={myEntriesFilter.setOn} /> : null}
            {toolbarActions}
          </span>
        ) : undefined}
      />
    </LeaderboardSection>
  );
}

/**
 * A contest's page once it is live or final (#1739): the contest's frame, the board's own notes
 * under the title, and the board underneath. Once the contest is final its settled note sits in an
 * (i) beside the Final chip, and a board that names its standings (`finalRows`) opens on the
 * winners banner (#1768).
 */
export function LeaderboardFrame({
  children,
  contest,
  finalRows,
  isUnscored = false,
  leagueCode,
  notes,
  settledNote = SETTLED_NOTE,
  summary,
}: {
  children: ReactNode;
  contest: ContestDto;
  /** The board's entries as the winners banner reads them; squares, with a winner per quarter, has none. */
  finalRows?: readonly FinalRow[];
  /** Whether nothing has been scored yet: the board lists every entry level at 0. */
  isUnscored?: boolean;
  leagueCode: string;
  /** The board's own lines under the title, such as the viewer's best place. */
  notes?: ReactNode;
  /** The settled words: `SETTLED_NOTE` unless the board has words of its own, or null where a note of its own stands instead. */
  settledNote?: ReactNode;
  summary?: ReactNode;
}) {
  const displayPreferences = useDisplayPreferences();
  const isFinal = contest.status === ContestStatus.COMPLETED;
  const winners = isFinal && finalRows ? describeFinalStandings(finalRows, displayPreferences.locale) : null;
  // #1768 — live before the first score, the board says when scoring starts rather than look broken.
  const firstStart = contest.status === ContestStatus.ACTIVE && isUnscored ? contestSchedule(contest)?.startsAt : undefined;
  const firstStartChip = firstStart ? (
    <Chip data-testid="contest-leaderboard-first-start" tone="info">
      {`${contest.contestFormat === ContestFormat.PREDICTION ? 'First game' : 'Scoring starts'} ${formatDateTimeDisplay(firstStart, displayPreferences)}`}
    </Chip>
  ) : null;
  return (
    <ContestPageFrame
      contest={contest}
      headerTestId="contest-leaderboard-header"
      leagueCode={leagueCode}
      notes={firstStartChip || notes ? <>{firstStartChip}{notes}</> : undefined}
      status={isFinal && settledNote ? (
        <span className="inline-flex items-center gap-1">
          <ContestStatusBadge status={contest.status} />
          <DetailsPeek label="About the final result" testId="contest-leaderboard-settled-note">
            <PeekCard subtitle={settledNote} facts={[]} testId="contest-leaderboard-settled-note-card" title="Final result" />
          </DetailsPeek>
        </span>
      ) : undefined}
      summary={summary}
      testId="contest-leaderboard"
    >
      {winners ? <WinnersBanner {...winners} testId="contest-winners" /> : null}
      {children}
    </ContestPageFrame>
  );
}

/**
 * The viewer's best placed entry, for the Standings title bar: the first of their squad's placed rows, since
 * the server ranks best first. Nothing when the viewer has no placed entry on the board.
 */
export function YourBestNote<Row extends BoardRow>({
  entries,
  mySquadId,
  points,
  testId,
}: {
  entries: Row[];
  mySquadId: string | null;
  /** The points the board ranks by. */
  points: (row: Row) => number;
  testId: string;
}) {
  const myBest = mySquadId === null
    ? undefined
    : entries.find((entry) => entry.squadId === mySquadId && entry.displayPosition !== null);
  if (!myBest) {
    return null;
  }
  return <Text data-testid={testId} variant="meta">{`Your best: ${myBest.displayPosition} · ${myBest.entryName}, ${formatPoints(points(myBest))}`}</Text>;
}
