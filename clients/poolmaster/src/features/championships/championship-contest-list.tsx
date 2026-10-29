import type { ContestResultSummaryDto } from '@/lib/api';
import { buildLeagueContestLeaderboardPath } from '@/features/leagues/league-routing';
import { EmptyState, ListStack, StatusBadge } from '@/features/shared/ui';
import { ContestRow } from '@/features/contests/contest-row';
import { formatCupPoints } from './cup-view';
import { describeContestResult } from './championship-view';

/**
 * A championship year's final contests (#837), newest first: its sports league and date, who won
 * and how many entries, and whether it counted. Filtered to a squad, each row also shows that
 * squad's place and points. A row opens its final leaderboard, or what `contestPath` names.
 */
export function ChampionshipContestList({
  contestPath = buildLeagueContestLeaderboardPath,
  contests,
  emptyBody,
  leagueCode,
  testIdPrefix = 'championship-contest',
}: {
  contestPath?: (leagueCode: string, contestId: string) => string;
  contests: ContestResultSummaryDto[];
  emptyBody: string;
  leagueCode: string;
  testIdPrefix?: string;
}) {
  if (!contests.length) {
    return <EmptyState body={emptyBody} testId={`${testIdPrefix}s-empty`} />;
  }

  return (
    <ListStack data-testid={`${testIdPrefix}s`}>
      {contests.map((contest) => {
        const state = describeContestResult(contest);
        return (
          <ContestRow
            completedAt={contest.completedAt}
            details={contest.sportLeagueName}
            key={contest.contestId}
            name={contest.name}
            note={state.note}
            startsAt={null}
            status={state.badge ? <StatusBadge tone="neutral">{state.badge}</StatusBadge> : null}
            testId={`${testIdPrefix}-${contest.contestId}`}
            to={contestPath(leagueCode, contest.contestId)}
            trailing={contest.squadFinish
              ? `${contest.squadFinish.displayPlace} · ${formatCupPoints(contest.squadFinish.points)} pts`
              : null}
          />
        );
      })}
    </ListStack>
  );
}
