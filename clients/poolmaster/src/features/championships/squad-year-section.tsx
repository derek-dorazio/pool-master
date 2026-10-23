import { championshipYear } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SquadDto } from '@/lib/api';
import { buildLeagueChampionshipsPath, buildLeagueCupSquadPath } from '@/features/leagues/league-routing';
import { Button, ErrorState, LoadingState, MetricGrid, MetricTile, Tile } from '@/features/shared/ui';
import { ChampionshipContestList } from './championship-contest-list';
import { ChampionshipStandingsGrid } from './championship-standings-grid';
import { describeContestResultFilter, historyCupsOnShow, historyYearTitle, type ContestResultFilter } from './championship-view';
import { describeMovement } from './cup-view';
import { SQUAD_MEDAL_TILES, describeSquadChampionship, describeSquadCup } from './squad-year-view';
import { useChampionshipContestsQuery, useSquadYearQuery } from './use-championship-query';

/**
 * A squad's year on its squad page (#872, mockup E): its cut of the Championships views, read
 * from the same rows the league pages show. Its championship place, its own medal counts, its
 * finish matrix row (a count narrows its contests), its place in each cup on show, and the
 * counted contests it placed in, each opening its final leaderboard.
 */
export function SquadYearSection({
  leagueCode,
  leagueId,
  squad,
}: {
  leagueCode: string;
  leagueId: string;
  squad: Pick<SquadDto, 'id' | 'name'>;
}) {
  const year = championshipYear(new Date());
  const squadYearQuery = useSquadYearQuery(leagueId, squad.id, year);
  const [place, setPlace] = useState<number | null>(null);
  const filter = useMemo<ContestResultFilter>(() => ({ squadId: squad.id, place }), [squad.id, place]);
  const contestsQuery = useChampionshipContestsQuery(leagueId, year, filter);
  const championship = squadYearQuery.data?.championship ?? null;
  const cups = historyCupsOnShow(squadYearQuery.data?.cups ?? []);

  return (
    <section className="space-y-4" data-testid="squad-year">
      <h2 className="text-lg font-semibold text-foreground">{historyYearTitle({ year, isOver: false })}</h2>
      {squadYearQuery.isError ? (
        <ErrorState body="We couldn't load this squad's year." testId="squad-year-error" />
      ) : !squadYearQuery.data ? (
        <LoadingState body="Loading this squad's year..." />
      ) : (
        <>
          {championship ? (
            <>
              <Tile className="space-y-1" padding="sm" radius="lg">
                <Link
                  className="flex flex-wrap items-baseline justify-between gap-2 hover:underline"
                  data-testid="squad-year-championship"
                  to={buildLeagueChampionshipsPath(leagueCode, year)}
                >
                  <span className="font-semibold text-foreground">{championship.name}</span>
                  <span className="text-sm text-muted-foreground" title={describeMovement(championship.standing.movement).description}>
                    {describeMovement(championship.standing.movement).label}
                  </span>
                </Link>
                <p className="text-sm text-foreground" data-testid="squad-year-championship-standing">
                  {describeSquadChampionship(championship)}
                </p>
              </Tile>

              <MetricGrid className="grid-cols-3 sm:grid-cols-6">
                {SQUAD_MEDAL_TILES.map((tile) => (
                  <div data-testid={`squad-year-tile-${tile.key}`} key={tile.key}>
                    <MetricTile label={tile.label} value={tile.count(championship.standing)} />
                  </div>
                ))}
              </MetricGrid>

              <ChampionshipStandingsGrid
                filter={filter}
                focusSquadId={squad.id}
                onFilter={(next) => setPlace(next.place)}
                rows={[championship.standing]}
                searchable={false}
              />
            </>
          ) : null}

          {cups.length ? (
            <Tile className="space-y-2" padding="sm" radius="lg">
              <h3 className="font-semibold text-foreground">Cups</h3>
              <ul className="space-y-1 text-sm" data-testid="squad-year-cups">
                {cups.map((cup) => (
                  <li key={cup.cupId}>
                    <Link
                      className="flex flex-wrap justify-between gap-2 hover:underline"
                      data-testid={`squad-year-cup-${cup.cupId}`}
                      to={buildLeagueCupSquadPath(leagueCode, year, cup.sportLeagueId, squad.id)}
                    >
                      <span className="text-foreground">{cup.name}</span>
                      <span className="text-muted-foreground">
                        {describeSquadCup(cup)}
                        {cup.standing.movement === null ? null : ` · ${describeMovement(cup.standing.movement).label}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Tile>
          ) : null}
        </>
      )}

      <Tile className="space-y-3" padding="sm" radius="lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground" data-testid="squad-year-contests-heading">
            {describeContestResultFilter(filter, squad.name, year)}
          </h3>
          {place === null ? null : (
            <Button data-testid="squad-year-contests-clear" onClick={() => setPlace(null)} size="sm" type="button" variant="subtle">
              Show every contest
            </Button>
          )}
        </div>
        {contestsQuery.isError ? (
          <ErrorState body="We couldn't load this squad's contests." testId="squad-year-contests-error" />
        ) : !contestsQuery.data ? (
          <LoadingState body="Loading this squad's contests..." />
        ) : (
          <ChampionshipContestList
            contests={contestsQuery.data}
            emptyBody={`${squad.name} hasn't placed in a counted contest in ${year} yet.`}
            leagueCode={leagueCode}
            testIdPrefix="squad-year-contest"
          />
        )}
      </Tile>
    </section>
  );
}
