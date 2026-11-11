import { championshipYear } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import type { SquadDto } from '@/lib/api';
import { buildLeagueChampionshipsPath, buildLeagueCupSquadPath } from '@/features/leagues/league-routing';
import { Button, ErrorState, LoadingState, MetricGrid, MetricTile, SectionBody, SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';
import { ChampionshipContestList } from './championship-contest-list';
import { ChampionshipStandingsGrid } from './championship-standings-grid';
import { describeContestResultFilter, historyCupsOnShow, type ContestResultFilter } from './championship-view';
import { describeMovement } from './cup-view';
import { SQUAD_MEDAL_TILES, describeSquadChampionship, describeSquadCup } from './squad-year-view';
import { useChampionshipContestsQuery, useSquadYearQuery } from './use-championship-query';

/**
 * One year of a squad on its squad page (#872, mockup E): its cut of the Championships views, read
 * from the same rows the league pages show. Its championship place, its own medal counts, its
 * finish matrix row (a count narrows its contests), its place in each cup on show, and the
 * counted contests it placed in, each opening its final leaderboard.
 */
export function SquadYearSection({
  leagueCode,
  leagueId,
  mySquadId,
  squad,
  year,
}: {
  leagueCode: string;
  leagueId: string;
  /** The viewer's own squad, marked You; null when they have none. */
  mySquadId: string | null;
  squad: Pick<SquadDto, 'id' | 'name'>;
  year: number;
}) {
  const squadYearQuery = useSquadYearQuery(leagueId, squad.id, year);
  const [place, setPlace] = useState<number | null>(null);
  const filter = useMemo<ContestResultFilter>(() => ({ squadId: squad.id, place }), [squad.id, place]);
  const contestsQuery = useChampionshipContestsQuery(leagueId, year, filter);
  const championship = squadYearQuery.data?.championship ?? null;
  const cups = historyCupsOnShow(squadYearQuery.data?.cups ?? []);
  const isOver = year < championshipYear(new Date());

  return (
    <div className="space-y-4" data-testid="squad-year">
      {squadYearQuery.isError ? (
        <ErrorState onRetry={() => void squadYearQuery.refetch()} body="We couldn't load this team's year." testId="squad-year-error" />
      ) : !squadYearQuery.data ? (
        <LoadingState body="Loading this team's year..." />
      ) : (
        <>
          {championship ? (
            <SectionCard headingLevel={3} title="Championship">
              <SectionRows>
                <SectionRow
                  facts={<span data-testid="squad-year-championship-standing">{describeSquadChampionship(championship)}</span>}
                  name={championship.name}
                  testId="squad-year-championship"
                  to={buildLeagueChampionshipsPath(leagueCode, year)}
                  value={<span title={describeMovement(championship.standing.movement).description}>{describeMovement(championship.standing.movement).label}</span>}
                />
              </SectionRows>
              <SectionBody>
                <MetricGrid className="grid-cols-3 sm:grid-cols-6">
                  {SQUAD_MEDAL_TILES.map((tile) => (
                    <div data-testid={`squad-year-tile-${tile.key}`} key={tile.key}>
                      <MetricTile label={tile.label} value={tile.count(championship.standing)} />
                    </div>
                  ))}
                </MetricGrid>

                <ChampionshipStandingsGrid
                  filter={filter}
                  focusSquadId={mySquadId}
                  onFilter={(next) => setPlace(next.place)}
                  rows={[championship.standing]}
                  searchable={false}
                />
              </SectionBody>
            </SectionCard>
          ) : null}

          {cups.length ? (
            <SectionCard headingLevel={3} title="Cups">
              <SectionRows testId="squad-year-cups">
                {cups.map((cup) => (
                  <SectionRow
                    facts={cup.standing.movement === null ? describeSquadCup(cup) : `${describeSquadCup(cup)} · ${describeMovement(cup.standing.movement).label}`}
                    key={cup.cupId}
                    name={cup.name}
                    testId={`squad-year-cup-${cup.cupId}`}
                    to={buildLeagueCupSquadPath(leagueCode, year, cup.sportLeagueId, squad.id)}
                  />
                ))}
              </SectionRows>
            </SectionCard>
          ) : null}
        </>
      )}

      <SectionCard
        headingLevel={3}
        title={describeContestResultFilter(filter, squad.name, year)}
        titleTestId="squad-year-contests-heading"
        trailing={place === null ? null : (
          <Button data-testid="squad-year-contests-clear" onClick={() => setPlace(null)} size="sm" type="button" variant="subtle">
            Show every contest
          </Button>
        )}
      >
        {contestsQuery.isError ? (
          <ErrorState onRetry={() => void contestsQuery.refetch()} body="We couldn't load this team's contests." size="inline" testId="squad-year-contests-error" />
        ) : !contestsQuery.data ? (
          <LoadingState rows={3} body="Loading this team's contests..." size="inline" />
        ) : (
          <ChampionshipContestList
            contests={contestsQuery.data}
            emptyBody={isOver ? `${squad.name} didn't place in a counted contest in ${year}.` : `${squad.name} hasn't placed in a counted contest in ${year} yet.`}
            leagueCode={leagueCode}
            testIdPrefix="squad-year-contest"
          />
        )}
      </SectionCard>
    </div>
  );
}
