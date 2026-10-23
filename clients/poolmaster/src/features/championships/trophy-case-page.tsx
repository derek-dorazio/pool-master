import { buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { EmptyState, ErrorState, ListStack, LoadingState } from '@/features/shared/ui';
import { CupSummaryCard } from './cup-summary-card';
import { useChampionshipsRoute } from './use-championships-route';
import { cupsOnShow } from './cup-view';
import { useSeasonCupsQuery } from './use-cups-query';

/** Trophy case: a card per sports league cup of the year, with its leader and the viewer's place. */
export function TrophyCasePage() {
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
