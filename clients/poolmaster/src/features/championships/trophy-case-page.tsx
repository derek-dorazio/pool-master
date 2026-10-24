import { buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { EmptyState, ErrorState, ListStack, LoadingState } from '@/features/shared/ui';
import { CrownCupBanner } from './crown-cup-banner';
import { CupSummaryCard } from './cup-summary-card';
import { PerpetualTrophies } from './perpetual-trophies';
import { useChampionshipsRoute } from './use-championships-route';
import { cupsOnShow, isReadyToCrown } from './cup-view';
import { useSeasonCupsQuery } from './use-cups-query';

/**
 * Trophy case: a card per sports league cup of the year, with its leader or champion and the
 * viewer's place. The commissioner sees "Ready to crown" above for each cup that can be crowned.
 * Below them, every year, the league's perpetual trophies (#874).
 */
export function TrophyCasePage() {
  const { leagueId } = useChampionshipsRoute();
  return (
    <ListStack>
      <SeasonCups />
      <PerpetualTrophies leagueId={leagueId} />
    </ListStack>
  );
}

function SeasonCups() {
  const { leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const cupsQuery = useSeasonCupsQuery(leagueId, year);

  if (cupsQuery.isLoading) {
    return <LoadingState body="Loading cups..." />;
  }
  if (cupsQuery.isError) {
    return <ErrorState body="We couldn't load this year's cups." testId="trophy-case-error" />;
  }
  const cups = cupsOnShow(cupsQuery.data ?? []);
  if (!cups.length) {
    return (
      <EmptyState
        body={`Every sports league the league runs contests in during ${year} gets its own cup, shown here once two of its contests have counted.`}
        testId="trophy-case-empty"
        title="No cups yet"
      />
    );
  }

  return (
    <ListStack data-testid="trophy-case">
      {viewer.isCommissioner
        ? cups.filter(isReadyToCrown).map((cup) => <CrownCupBanner cup={cup} key={`crown-${cup.id}`} leagueId={leagueId} />)
        : null}
      {cups.map((cup) => (
        <CupSummaryCard
          cup={cup}
          focus={{ squadId: viewer.mySquadId, isViewer: true }}
          key={cup.id}
          to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
        />
      ))}
    </ListStack>
  );
}
