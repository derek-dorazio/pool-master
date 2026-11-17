import { describeSquaresRules } from '@poolmaster/shared/domain';
import type { ContestDto, SquaresBoardResponse } from '@/lib/api';
import { LeaderboardFrame } from './leaderboard-kit';
import { SquaresBoardView } from './squares-board-view';
import { useSquaresBoardQuery } from './use-squares-board';
import { useContestLeague } from './use-contest-league';
import { useLinkedEntry } from './use-linked-entry';

/** A squares contest's rules sentence, once its board has loaded with the box limit. */
function squaresRules(board: SquaresBoardResponse | undefined) {
  return board ? describeSquaresRules(board.maxSquaresPerEntry) : null;
}

/**
 * A squares contest's leaderboard (#711, #1758): the score and winners tabs above the board, where
 * every entry shows by its boxes, so there is no list of entries below it. A link naming an entry
 * (`?entry=`, #1762) shades its boxes as the viewer's own are and scrolls to the board.
 */
export function SquaresLeaderboard({ contest }: { contest: ContestDto }) {
  const boardQuery = useSquaresBoardQuery(contest);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);
  const linkedEntry = useLinkedEntry();

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      settledNote="Final result: the winners are frozen at settlement."
      summary={(
        <span data-testid="squares-leaderboard-rules">{squaresRules(boardQuery.data)}</span>
      )}
    >
      <SquaresBoardView
        canManage={viewer.isCommissioner || viewer.isRootAdmin}
        contest={contest}
        linkedEntryId={linkedEntry.entryId}
        myEntryIds={contest.myEntryIds ?? []}
      />
    </LeaderboardFrame>
  );
}
