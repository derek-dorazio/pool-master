import { useParams } from 'react-router';
import { PlanFeature } from '@poolmaster/shared/domain';
import { buildLeagueContestLeaderboardPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  ListStack,
  LoadingState,
  Tile,
} from '@/features/shared/ui';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { hasErrorCode } from '@/lib/errors';
import { ContestRow } from '@/features/contests/contest-row';
import { CUP_WEIGHT_LABELS, formatCupPoints } from './cup-view';
import { useChampionshipsRoute } from './use-championships-route';
import { useCupSquadPointsQuery } from './use-cups-query';

/**
 * One squad's points in a cup, counted contest by counted contest, each opening its leaderboard.
 * On a plan without cups, the locked note instead (#948).
 */
export function CupSquadPointsPage() {
  const { sportLeagueId = '', squadId = '' } = useParams<{ sportLeagueId: string; squadId: string }>();
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const isInPlan = hasPlanFeature(league, PlanFeature.CUP_STANDINGS);
  const pointsQuery = useCupSquadPointsQuery(isInPlan ? leagueId : '', year, sportLeagueId, squadId);

  if (!isInPlan) {
    return <PlanLockedNotice feature={PlanFeature.CUP_STANDINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (pointsQuery.isLoading) {
    return <LoadingState body="Loading cup points..." />;
  }
  if (pointsQuery.isError && !hasErrorCode(pointsQuery.error, 'CUP_NOT_FOUND')) {
    return <ErrorState body="We couldn't load this squad's cup points." testId="cup-squad-points-error" />;
  }
  if (!pointsQuery.data) {
    return <EmptyState body={`This league has no cup for that sports league in ${year}.`} testId="cup-squad-points-no-cup" title="Cup not found" />;
  }
  const squadPoints = pointsQuery.data;

  return (
    <Tile className="space-y-5" data-testid="cup-squad-points" padding="sm" radius="lg">
      <Breadcrumbs
        items={[
          { href: buildLeaguePointsRacePath(leagueCode, year, sportLeagueId), label: squadPoints.cupName },
          { label: squadPoints.squadName },
        ]}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">{squadPoints.squadName}</h2>
        <p className="text-lg font-semibold tabular-nums text-foreground" data-testid="cup-squad-points-total">
          {formatCupPoints(squadPoints.points)} pts
        </p>
      </div>
      {squadPoints.contests.length ? (
        <ListStack>
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
                to={buildLeagueContestLeaderboardPath(leagueCode, contest.contestId)}
                trailing={`${formatCupPoints(contest.points)} pts`}
              />
            );
          })}
        </ListStack>
      ) : (
        <EmptyState body="No contest in this cup has counted yet." />
      )}
    </Tile>
  );
}
