import { useParams } from 'react-router';
import { ContestStatus, PlanFeature } from '@poolmaster/shared/domain';
import { buildContestLandingPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import {
  Breadcrumbs,
  ErrorState,
  LoadingState,
  SectionCard,
  SectionEmpty,
  SectionRows,
  formatCupPoints,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { hasErrorCode } from '@/lib/errors';
import { ContestRow } from '@/features/contests/contest-row';
import { CUP_WEIGHT_LABELS } from './cup-view';
import { useChampionshipsRoute } from './use-championships-route';
import { useCupSquadPointsQuery } from './use-cups-query';

/**
 * One squad's points in a cup, counted contest by counted contest, each opening its leaderboard.
 * On a plan without cups, the locked note instead (#948).
 */
export function CupSquadPointsPage() {
  const { sportLeagueId = '', squadId = '' } = useParams<{ sportLeagueId: string; squadId: string }>();
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const { locale } = useDisplayPreferences();
  const isInPlan = hasPlanFeature(league, PlanFeature.CUP_STANDINGS);
  const pointsQuery = useCupSquadPointsQuery(isInPlan ? leagueId : '', year, sportLeagueId, squadId);

  if (!isInPlan) {
    return <PlanLockedNotice feature={PlanFeature.CUP_STANDINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (pointsQuery.isLoading) {
    return <LoadingState body="Loading cup points..." />;
  }
  if (pointsQuery.isError && !hasErrorCode(pointsQuery.error, 'CUP_NOT_FOUND')) {
    return <ErrorState body="We couldn't load this team's cup points." onRetry={() => void pointsQuery.refetch()} testId="cup-squad-points-error" />;
  }
  if (!pointsQuery.data) {
    return (
      <SectionCard testId="cup-squad-points-no-cup" title="Cup not found">
        <SectionEmpty>{`This league has no cup for that sports league in ${year}.`}</SectionEmpty>
      </SectionCard>
    );
  }
  const squadPoints = pointsQuery.data;

  return (
    <div className="space-y-4" data-testid="cup-squad-points">
      <Breadcrumbs
        items={[
          { href: buildLeaguePointsRacePath(leagueCode, year, sportLeagueId), label: squadPoints.cupName },
          { label: squadPoints.squadName },
        ]}
      />
      <SectionCard
        title={squadPoints.squadName}
        trailing={<span data-testid="cup-squad-points-total">{formatCupPoints(squadPoints.points, locale)} pts</span>}
      >
        {squadPoints.contests.length ? (
          <SectionRows>
            {squadPoints.contests.map((contest) => {
              const weight = CUP_WEIGHT_LABELS[contest.cupWeight];
              return (
                <ContestRow
                  completedAt={contest.completedAt}
                  key={contest.contestId}
                  name={contest.name}
                  note={contest.displayPlace
                    ? `${contest.displayPlace} of ${contest.rankedEntryCount}${weight ? ` · ${weight}` : ''}`
                    : 'No entry'}
                  startsAt={null}
                  testId={`cup-squad-contest-${contest.contestId}`}
                  to={buildContestLandingPath(leagueCode, { id: contest.contestId, status: ContestStatus.COMPLETED })}
                  trailing={`${formatCupPoints(contest.points, locale)} pts`}
                />
              );
            })}
          </SectionRows>
        ) : (
          <SectionEmpty>No contest in this cup has counted yet.</SectionEmpty>
        )}
      </SectionCard>
    </div>
  );
}
