import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Trophy } from 'lucide-react';
import { PlanFeature } from '@poolmaster/shared/domain';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { Button, ErrorState, Eyebrow, LoadingState, MetricGrid, MetricTile, Tile } from '@/features/shared/ui';
import { describePointsTable } from './cup-settings-view';
import { joinNames } from './cup-view';
import { ChampionshipContestList } from './championship-contest-list';
import { ChampionshipStandingsGrid } from './championship-standings-grid';
import {
  CHAMPIONSHIP_TILE_LABELS,
  buildPodium,
  describeChampionshipStanding,
  describeContestResultFilter,
  parseContestResultFilter,
  type ContestResultFilter,
} from './championship-view';
import { Podium } from './podium';
import { useChampionshipContestsQuery, useChampionshipQuery } from './use-championship-query';
import { useChampionshipsRoute } from './use-championships-route';

/**
 * Championship (#863): the league championship of the year across every sport. The trophy and
 * podium once the year is over, the leader before; then the medal tiles, the finish matrix, and
 * the year's contests (#837), which a matrix count narrows to the contests behind it. On a plan
 * without the championship, the locked note instead (#948).
 */
export function ChampionshipPage() {
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const isInPlan = hasPlanFeature(league, PlanFeature.CHAMPIONSHIP);
  const championshipQuery = useChampionshipQuery(isInPlan ? leagueId : '', year);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseContestResultFilter(searchParams, championshipQuery.data?.standings ?? []);
  // The list waits for the standings, so a filter in the link is checked before it is asked for.
  const contestsQuery = useChampionshipContestsQuery(championshipQuery.data ? leagueId : '', year, filter);
  const chooseFilter = useCallback((next: ContestResultFilter | null) => {
    setSearchParams(next === null ? {} : { squad: next.squadId, ...(next.place === null ? {} : { place: String(next.place) }) }, { replace: true });
  }, [setSearchParams]);

  if (!isInPlan) {
    return <PlanLockedNotice feature={PlanFeature.CHAMPIONSHIP} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (championshipQuery.isLoading) {
    return <LoadingState body="Loading the championship..." />;
  }
  if (championshipQuery.isError || !championshipQuery.data) {
    return <ErrorState body="We couldn't load this year's championship." testId="championship-error" />;
  }
  const championship = championshipQuery.data;
  const filteredSquadName = championship.standings.find((row) => row.squadId === filter?.squadId)?.squadName ?? '';
  const podium = championship.isOver ? buildPodium(championship.standings) : [];

  return (
    <div className="space-y-6" data-testid="championship">
      <Tile className="flex flex-col items-center gap-3 text-center" padding="sm" radius="lg">
        {championship.isOver ? <Trophy aria-hidden className="text-primary" size={56} /> : null}
        <h2 className="text-xl font-black italic text-foreground" data-testid="championship-name">{championship.name}</h2>
        {championship.isOver && podium.length ? (
          <Eyebrow tone="muted">
            {(podium[0]?.squads.length ?? 0) > 1 ? 'Champions' : 'Champion'}
          </Eyebrow>
        ) : null}
        <p className="text-sm text-foreground" data-testid="championship-standing">{describeChampionshipStanding(championship)}</p>
        {!championship.isOver ? (
          <p className="text-xs text-muted-foreground">
            The trophy is presented on 1 January. Contests still live then count toward {year + 1}.
          </p>
        ) : null}
        {podium.length ? (
          <div className="w-full max-w-sm pt-2">
            <Podium focusSquadId={viewer.mySquadId} steps={podium} testId="championship-podium" />
          </div>
        ) : null}
      </Tile>

      <MetricGrid>
        {championship.tiles.map((tile) => (
          <div data-testid={`championship-tile-${tile.tile}`} key={tile.tile}>
            <MetricTile
              helperText={tile.squads.length ? joinNames(tile.squads.map((squad) => squad.squadName)) : 'Nobody yet'}
              label={CHAMPIONSHIP_TILE_LABELS[tile.tile]}
              value={tile.count}
            />
          </div>
        ))}
      </MetricGrid>

      <Tile className="space-y-3" padding="sm" radius="lg">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Finishes in {year}</h2>
          <span className="text-xs text-muted-foreground" data-testid="championship-progress">
            {championship.contestsCounted} {championship.contestsCounted === 1 ? 'contest' : 'contests'} final
          </span>
        </div>
        <ChampionshipStandingsGrid filter={filter} focusSquadId={viewer.mySquadId} onFilter={chooseFilter} rows={championship.standings} />
        {league ? (
          <p className="text-xs text-muted-foreground">
            Points table: {describePointsTable({ scale: league.cupPointsScale, customPoints: league.cupCustomPoints })}.
            Each contest&apos;s weight multiplies it, and a contest keeps the points it earned when it went final.
          </p>
        ) : null}
      </Tile>

      <Tile className="space-y-3" padding="sm" radius="lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground" data-testid="championship-contests-heading">
            {describeContestResultFilter(filter, filteredSquadName, year)}
          </h2>
          {filter ? (
            <Button data-testid="championship-contests-clear" onClick={() => chooseFilter(null)} size="sm" type="button" variant="subtle">
              Show every contest
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Tap a count in the table to see its contests.</span>
          )}
        </div>
        {contestsQuery.isError ? (
          <ErrorState body="We couldn't load this year's contests." testId="championship-contests-error" />
        ) : !contestsQuery.data ? (
          <LoadingState body="Loading the year's contests..." />
        ) : (
          <ChampionshipContestList
            contests={contestsQuery.data}
            emptyBody={`No contest went final in ${year}.`}
            leagueCode={leagueCode}
          />
        )}
      </Tile>
    </div>
  );
}
