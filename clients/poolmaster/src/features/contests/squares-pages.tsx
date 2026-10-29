import type { ColumnDef } from '@tanstack/react-table';
import { useLocation, useParams } from 'react-router';
import { describeSquaresRules } from '@poolmaster/shared/domain';
import type { ContestDto, SquaresBoardResponse, SquaresEntryDto } from '@/lib/api';
import { parseRouteState } from '@/routes/route-state';
import { ContestEntryBackLinks, ContestPageFrame } from './contest-header';
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
  const { entryId = '', leagueCode: routeLeagueCode } = useParams<{ entryId: string; leagueCode?: string }>();
  const location = useLocation();
  const contestId = contest.id;
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  const boardQuery = useSquaresBoardQuery(contest);
  const entryQuery = useContestEntryQuery(contestId, entryId);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId, hintedLeagueCode);
  const entry = entryQuery.data?.entry ?? null;

  return (
    <ContestPageFrame
      actions={<ContestEntryBackLinks contestId={contestId} leagueCode={leagueCode} />}
      contest={contest}
      current={entryPageView(contest, entryId)}
      leagueCode={leagueCode}
      picksRevealed={entryQuery.data?.picksRevealed ?? false}
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
          {[contest.name, squaresRules(boardQuery.data)].filter((part) => part !== null).join(' · ')}
        </p>
      )}
      testId="squares-entry-page"
      title={entry?.name ?? contest.name}
      titleTestId="contest-entry-heading"
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
function standingsColumns(contestId: string, leagueCode: string | null, myEntryIds: readonly string[]): ColumnDef<StandingRow>[] {
  return [
    placeColumn(TEST_ID),
    // A squares entry names no squad, so the viewer's own are the entries the contest says are theirs.
    entryColumn(TEST_ID, { contestId, isMine: (row) => myEntryIds.includes(row.entryId), leagueCode }),
    { id: 'boxes', header: 'Boxes', accessorFn: (row) => row.boxCount },
    totalColumn(TEST_ID, { header: 'Quarters won', id: 'won', value: (row) => row.periodsWon }),
  ];
}

/**
 * A squares contest's leaderboard (#711): each quarter's winner and the grid with the winning
 * boxes outlined, then every entry with its boxes and the quarters it won, placed once Final.
 */
export function SquaresLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const boardQuery = useSquaresBoardQuery(contest);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId, hintedLeagueCode);

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      settledNote="Final result: the winners are frozen at settlement."
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="squares-leaderboard-rules">{squaresRules(boardQuery.data)}</p>
      )}
    >
      <SquaresBoardView canManage={viewer.isCommissioner || viewer.isRootAdmin} contest={contest} myEntryIds={contest.myEntryIds ?? []} />
      {boardQuery.data ? (
        <ScoreboardGrid
          columns={standingsColumns(contest.id, leagueCode, contest.myEntryIds ?? [])}
          data={boardQuery.data.entries.map((row) => ({ ...row, entryId: row.contestEntryId }))}
          emptyMessage="No entry holds a box yet."
          rowTestIdPrefix="squares-standing-row"
          tableTestId="squares-standings-table"
        />
      ) : null}
    </LeaderboardFrame>
  );
}
