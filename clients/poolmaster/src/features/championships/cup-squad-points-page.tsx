import { useParams } from 'react-router-dom';
import { PlanFeature } from '@poolmaster/shared/domain';
import { buildLeagueContestLeaderboardPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  ListCard,
  ListStack,
  LoadingState,
  Tile,
} from '@/features/shared/ui';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { CUP_WEIGHT_LABELS, formatCupPoints } from './cup-view';
import { useChampionshipsRoute } from './use-championships-route';
import { useCupSquadPointsQuery, useSeasonCupsQuery } from './use-cups-query';

/**
 * One squad's points in a cup, counted contest by counted contest, each opening its leaderboard.
 * On a plan without cups, the locked note instead (#948).
 */
export function CupSquadPointsPage() {
  const { sportLeagueId = '', squadId = '' } = useParams<{ sportLeagueId: string; squadId: string }>();
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const isInPlan = hasPlanFeature(league, PlanFeature.CUP_STANDINGS);
  const cupsQuery = useSeasonCupsQuery(isInPlan ? leagueId : '', year);
  const cup = cupsQuery.data?.find((candidate) => candidate.sportLeagueId === sportLeagueId);
  const pointsQuery = useCupSquadPointsQuery(leagueId, cup?.id ?? '', squadId);

  if (!isInPlan) {
    return <PlanLockedNotice feature={PlanFeature.CUP_STANDINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (cupsQuery.isLoading || (cup && pointsQuery.isLoading)) {
    return <LoadingState body="Loading cup points..." />;
  }
  if (cupsQuery.isError || pointsQuery.isError) {
    return <ErrorState body="We couldn't load this squad's cup points." testId="cup-squad-points-error" />;
  }
  if (!cup || !pointsQuery.data) {
    return <EmptyState body={`This league has no cup for that sports league in ${year}.`} testId="cup-squad-points-no-cup" title="Cup not found" />;
  }
  const squadPoints = pointsQuery.data;

  return (
    <Tile className="space-y-5" data-testid="cup-squad-points" padding="sm" radius="lg">
      <Breadcrumbs
        items={[
          { href: buildLeaguePointsRacePath(leagueCode, year, sportLeagueId), label: cup.name },
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
              <ListCard
                data-testid={`cup-squad-contest-${contest.contestId}`}
                description={contest.displayPlace
                  ? `${contest.displayPlace} of ${contest.rankedEntryCount}${weight ? ` · ${weight}` : ''}`
                  : 'No entry'}
                key={contest.contestId}
                title={contest.name}
                to={buildLeagueContestLeaderboardPath(leagueCode, contest.contestId)}
                trailing={<span className="font-semibold tabular-nums text-foreground">{formatCupPoints(contest.points)} pts</span>}
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
