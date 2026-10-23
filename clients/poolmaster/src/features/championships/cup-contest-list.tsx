import { ContestStatus } from '@poolmaster/shared/domain';
import type { CupContestRowDto } from '@/lib/api';
import { buildLeagueContestLeaderboardPath, buildLeagueContestPath } from '@/features/leagues/league-routing';
import { EmptyState, ListCard, ListStack, StatusBadge } from '@/features/shared/ui';
import { CUP_WEIGHT_LABELS, describeCupContest } from './cup-view';

/**
 * Every contest in a cup with its weight, its state and why: who won it, or why it doesn't count.
 * A live or final contest opens its leaderboard; one still open opens the contest.
 */
export function CupContestList({ contests, leagueCode }: { contests: CupContestRowDto[]; leagueCode: string }) {
  if (!contests.length) {
    return <EmptyState body="No contests in this cup yet." />;
  }

  return (
    <ListStack data-testid="cup-contests">
      {contests.map((contest) => {
        const state = describeCupContest(contest);
        const weight = CUP_WEIGHT_LABELS[contest.cupWeight];
        return (
          <ListCard
            data-testid={`cup-contest-${contest.contestId}`}
            description={state.note}
            key={contest.contestId}
            title={contest.name}
            to={contest.status === ContestStatus.OPEN
              ? buildLeagueContestPath(leagueCode, contest.contestId)
              : buildLeagueContestLeaderboardPath(leagueCode, contest.contestId)}
            trailing={(
              <span className="inline-flex items-center gap-2">
                {weight ? <span className="font-semibold text-foreground">{weight}</span> : null}
                <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
              </span>
            )}
          />
        );
      })}
    </ListStack>
  );
}
