import type { CupContestRowDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { SectionEmpty, SectionRows, StatusBadge } from '@/features/shared/ui';
import { ContestRow } from '@/features/contests/contest-row';
import { cupWeightMark, describeCupContest } from './cup-view';

/**
 * Every contest in a cup with its weight, its state and why: who won it, or why it doesn't count.
 * Each row opens where every contest list opens it (#1389). It is a section card's body.
 */
export function CupContestList({ contests, leagueCode }: { contests: CupContestRowDto[]; leagueCode: string }) {
  if (!contests.length) {
    return <SectionEmpty>No contests in this cup yet.</SectionEmpty>;
  }

  return (
    <SectionRows testId="cup-contests">
      {contests.map((contest) => {
        const state = describeCupContest(contest);
        const weight = cupWeightMark(contest.cupWeight);
        return (
          <ContestRow
            completedAt={contest.completedAt}
            key={contest.contestId}
            name={contest.name}
            note={state.note}
            startsAt={contest.firstEventStartsAt}
            status={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
            testId={`cup-contest-${contest.contestId}`}
            to={buildLeagueContestPath(leagueCode, contest.contestId)}
            trailing={weight}
          />
        );
      })}
    </SectionRows>
  );
}
