import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestResultSummaryDto } from '@/lib/api';
import { buildContestLandingPath } from '@/features/leagues/league-routing';
import { SectionEmpty, SectionRows, StatusBadge, formatCupPoints, formatPlace, useDisplayPreferences } from '@/features/shared/ui';
import { ContestRow } from '@/features/contests/contest-row';
import { describeContestResult, SquadFinishShown } from './championship-view';

/**
 * A championship year's final contests (#837), newest first: its sports league and date, who won
 * and how many entries, and whether it counted. A row that carries a squad's finish shows it:
 * place and points, or the place alone (`finishShown`). Every contest here is final, so a row opens it where a final
 * contest opens (#1389): its leaderboard. `focusContestId` tints and scrolls to the contest the
 * viewer came from (#1392). It is a section card's body.
 */
export function ChampionshipContestList({
  contests,
  emptyBody,
  finishShown = SquadFinishShown.PLACE_AND_POINTS,
  focusContestId = null,
  leagueCode,
  testIdPrefix = 'championship-contest',
}: {
  contests: ContestResultSummaryDto[];
  emptyBody: string;
  finishShown?: SquadFinishShown;
  /** The contest the viewer came from, from the page's `?focus=`. */
  focusContestId?: string | null;
  leagueCode: string;
  testIdPrefix?: string;
}) {
  const { locale } = useDisplayPreferences();
  if (!contests.length) {
    return <SectionEmpty testId={`${testIdPrefix}s-empty`}>{emptyBody}</SectionEmpty>;
  }

  return (
    <SectionRows testId={`${testIdPrefix}s`}>
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
            trailing={contest.squadFinish ? describeSquadFinish(contest.squadFinish, finishShown, locale) : null}
          />
        );
      })}
    </SectionRows>
  );
}

function describeSquadFinish(finish: NonNullable<ContestResultSummaryDto['squadFinish']>, shown: SquadFinishShown, locale: string): string {
  if (shown === SquadFinishShown.PLACE) {
    return formatPlace({ displayPosition: finish.displayPlace, position: finish.place });
  }
  return `${finish.displayPlace} · ${formatCupPoints(finish.points, locale)} pts`;
}
