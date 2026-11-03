import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestResultSummaryDto } from '@/lib/api';
import { buildContestLandingPath } from '@/features/leagues/league-routing';
import { EmptyState, ListStack, StatusBadge } from '@/features/shared/ui';
import { ContestRow } from '@/features/contests/contest-row';
import { formatCupPoints } from './cup-view';
import { describeContestResult } from './championship-view';

/**
 * A championship year's final contests (#837), newest first: its sports league and date, who won
 * and how many entries, and whether it counted. Filtered to a squad, each row also shows that
 * squad's place and points. Every contest here is final, so a row opens it where a final
 * contest opens (#1389): its leaderboard. `focusContestId` tints and scrolls to the contest the
 * viewer came from (#1392).
 */
export function ChampionshipContestList({
  contests,
  emptyBody,
  focusContestId = null,
  leagueCode,
  testIdPrefix = 'championship-contest',
}: {
  contests: ContestResultSummaryDto[];
  emptyBody: string;
  /** The contest the viewer came from, from the page's `?focus=`. */
  focusContestId?: string | null;
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
            isHighlighted={contest.contestId === focusContestId}
            key={contest.contestId}
            name={contest.name}
            note={state.note}
            startsAt={null}
            status={state.badge ? <StatusBadge tone="neutral">{state.badge}</StatusBadge> : null}
            testId={`${testIdPrefix}-${contest.contestId}`}
            to={buildContestLandingPath(leagueCode, { id: contest.contestId, status: ContestStatus.COMPLETED })}
            trailing={contest.squadFinish
              ? `${contest.squadFinish.displayPlace} · ${formatCupPoints(contest.squadFinish.points)} pts`
              : null}
          />
        );
      })}
    </ListStack>
  );
}
