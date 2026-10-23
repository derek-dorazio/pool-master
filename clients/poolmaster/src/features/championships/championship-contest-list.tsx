import type { ContestResultSummaryDto } from '@/lib/api';
import { buildLeagueContestLeaderboardPath } from '@/features/leagues/league-routing';
import { DateDisplay, EmptyState, ListCard, ListStack, StatusBadge } from '@/features/shared/ui';
import { formatCupPoints } from './cup-view';
import { describeContestResult } from './championship-view';

/**
 * A championship year's final contests (#837), newest first, each opening its final leaderboard:
 * its sports league and date, who won and how many entries, and whether it counted. Filtered to a
 * squad, each row also shows that squad's place and points.
 */
export function ChampionshipContestList({
  contests,
  emptyBody,
  leagueCode,
}: {
  contests: ContestResultSummaryDto[];
  emptyBody: string;
  leagueCode: string;
}) {
  if (!contests.length) {
    return <EmptyState body={emptyBody} testId="championship-contests-empty" />;
  }

  return (
    <ListStack data-testid="championship-contests">
      {contests.map((contest) => {
        const state = describeContestResult(contest);
        return (
          <ListCard
            data-testid={`championship-contest-${contest.contestId}`}
            description={state.note}
            key={contest.contestId}
            metadata={(
              <>
                <span>{contest.sportLeagueName}</span>
                <DateDisplay className="text-muted-foreground" timeStyle={null} value={contest.completedAt} />
              </>
            )}
            title={contest.name}
            to={buildLeagueContestLeaderboardPath(leagueCode, contest.contestId)}
            trailing={(
              <span className="inline-flex items-center gap-2">
                {contest.squadFinish ? (
                  <span className="font-semibold tabular-nums text-foreground">
                    {contest.squadFinish.displayPlace} · {formatCupPoints(contest.squadFinish.points)} pts
                  </span>
                ) : null}
                {state.badge ? <StatusBadge tone="neutral">{state.badge}</StatusBadge> : null}
              </span>
            )}
          />
        );
      })}
    </ListStack>
  );
}
