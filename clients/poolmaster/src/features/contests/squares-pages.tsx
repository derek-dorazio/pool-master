import type { ColumnDef } from '@tanstack/react-table';
import { useParams } from 'react-router';
import { describeSquaresRules } from '@poolmaster/shared/domain';
import type { ContestDto, SquaresBoardResponse, SquaresEntryDto } from '@/lib/api';
import { ContestPageFrame } from './contest-header';
import { entryPageView } from './contest-page-view';
import { entryColumn, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid } from './leaderboard-kit';
import { SquaresBoardView } from './squares-board-view';
import { useSquaresBoardQuery } from './use-squares-board';
import { useContestEntryQuery } from './use-contest-entries';
import { useContestLeague } from './use-contest-league';

/** The prefix of the standings' test ids. */
const TEST_ID = 'squares-standing';

/** A squares contest's rules sentence, once its board has loaded with the box limit. */
function squaresRules(board: SquaresBoardResponse | undefined) {
  return board ? describeSquaresRules(board.maxSquaresPerEntry) : null;
}

/**
 * A squares contest's entry page (#711): the grid, where the entry's owners claim its boxes until
 * the numbers are drawn, and then follow each quarter's winner.
 */
export function SquaresEntryPage({ contest }: { contest: ContestDto }) {
  const { entryId = '' } = useParams<{ entryId: string }>();
  const contestId = contest.id;
  const boardQuery = useSquaresBoardQuery(contest);
  const entryQuery = useContestEntryQuery(contestId, entryId);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);
  const entry = entryQuery.data?.entry ?? null;

  return (
    <ContestPageFrame
      contest={contest}
      current={entryPageView(contest, entryId)}
      entryName={entry?.name ?? ''}
      headerTestId="contest-entry-header"
      leagueCode={leagueCode}
      picksRevealed={entryQuery.data?.picksRevealed ?? false}
      summary={(
        <span data-testid="contest-entry-summary">
          {[contest.name, squaresRules(boardQuery.data)].filter((part) => part !== null).join(' · ')}
        </span>
      )}
      testId="squares-entry-page"
      title={entry?.name ?? contest.name}
    >
      <SquaresBoardView
        canManage={viewer.isCommissioner || viewer.isRootAdmin}
        contest={contest}
        myEntryIds={contest.myEntryIds ?? []}
        shownEntryId={entryId}
      />
    </ContestPageFrame>
  );
}

/** A standings row: a squares entry, by the id every board names its entry with. */
type StandingRow = SquaresEntryDto & { entryId: string };

/** The standings' columns: place once Final, the entry, its boxes and the quarters it won. */
function standingsColumns(contestId: string, leagueCode: string, leagueId: string, myEntryIds: readonly string[]): ColumnDef<StandingRow>[] {
  return [
    placeColumn(TEST_ID),
    // A squares entry names no squad, so the viewer's own are the entries the contest says are theirs.
    entryColumn(TEST_ID, { contestId, isMine: (row) => myEntryIds.includes(row.entryId), leagueCode, leagueId }),
    { id: 'boxes', header: 'Boxes', accessorFn: (row) => row.boxCount },
    totalColumn(TEST_ID, { header: 'Quarters won', id: 'won', value: (row) => row.periodsWon }),
  ];
}

/**
 * A squares contest's leaderboard (#711): each quarter's winner and the grid with the winning
 * boxes outlined, then every entry with its boxes and the quarters it won, placed once Final.
 */
export function SquaresLeaderboard({ contest }: { contest: ContestDto }) {
  const boardQuery = useSquaresBoardQuery(contest);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      settledNote="Final result: the winners are frozen at settlement."
      summary={(
        <span data-testid="squares-leaderboard-rules">{squaresRules(boardQuery.data)}</span>
      )}
    >
      <SquaresBoardView canManage={viewer.isCommissioner || viewer.isRootAdmin} contest={contest} myEntryIds={contest.myEntryIds ?? []} />
      {boardQuery.data ? (
        <ScoreboardGrid
          columns={standingsColumns(contest.id, leagueCode, contest.leagueId, contest.myEntryIds ?? [])}
          data={boardQuery.data.entries.map((row) => ({ ...row, entryId: row.contestEntryId }))}
          emptyMessage="No entry holds a box yet."
          rowTestIdPrefix="squares-standing-row"
          tableTestId="squares-standings-table"
        />
      ) : null}
    </LeaderboardFrame>
  );
}
