import { championshipYear } from '@poolmaster/shared/domain';
import { Trophy } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SquadDto } from '@/lib/api';
import { buildLeagueChampionshipsPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { Button, ErrorState, LoadingState, MetricGrid, MetricTile, Select, Tile } from '@/features/shared/ui';
import { historyYearTitle } from './championship-view';
import { championshipYearsOffered, parseChampionshipYearParam } from './championship-year';
import { SquadYearSection } from './squad-year-section';
import { describeSquadTrophy, describeSquadYearLine, isChampionshipTrophy, squadYearsPlaced } from './squad-year-view';
import { useSquadHistoryQuery } from './use-championship-query';

/**
 * A squad's results on its squad page (#872, mockup E): the year picked (`?year=`, the current one
 * by default) with its championship, cups and contests; then its trophy case, with its contest
 * medals all time and every trophy it has won; then an All years strip, one line per year it
 * placed in, each opening that year here.
 */
export function SquadHistorySection({
  leagueCode,
  leagueId,
  squad,
}: {
  leagueCode: string;
  leagueId: string;
  squad: Pick<SquadDto, 'id' | 'name'>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentYear = championshipYear(new Date());
  const year = parseChampionshipYearParam(searchParams.get('year') ?? undefined) ?? currentYear;
  const historyQuery = useSquadHistoryQuery(leagueId, squad.id);
  const years = championshipYearsOffered([year, ...(historyQuery.data?.years ?? []).map((row) => row.year)], [], currentYear);
  const chooseYear = (next: number) => {
    setSearchParams(next === currentYear ? {} : { year: String(next) }, { replace: true });
  };
  const placedYears = squadYearsPlaced(historyQuery.data?.years ?? []);

  return (
    <section className="space-y-6" data-testid="squad-history">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">{historyYearTitle({ year, isOver: year < currentYear })}</h2>
          <Select
            aria-label="Year"
            className="w-auto"
            data-testid="squad-history-year"
            onChange={(event) => chooseYear(Number(event.target.value))}
            value={year}
          >
            {years.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </div>
        <SquadYearSection key={year} leagueCode={leagueCode} leagueId={leagueId} squad={squad} year={year} />
      </div>

      {historyQuery.isError ? (
        <ErrorState body="We couldn't load this squad's trophies and past years." testId="squad-history-error" />
      ) : !historyQuery.data ? (
        <LoadingState body="Loading this squad's trophies..." />
      ) : (
        <>
          <Tile className="space-y-3" padding="sm" radius="lg">
            <h2 className="text-lg font-semibold text-foreground">Trophy case</h2>
            <MetricGrid className="grid-cols-3">
              <div data-testid="squad-history-medal-firsts"><MetricTile label="Contest 1sts" value={historyQuery.data.medals.firsts} /></div>
              <div data-testid="squad-history-medal-seconds"><MetricTile label="Contest 2nds" value={historyQuery.data.medals.seconds} /></div>
              <div data-testid="squad-history-medal-thirds"><MetricTile label="Contest 3rds" value={historyQuery.data.medals.thirds} /></div>
            </MetricGrid>
            {historyQuery.data.trophies.length ? (
              <ul className="space-y-1 text-sm" data-testid="squad-history-trophies">
                {historyQuery.data.trophies.map((trophy) => (
                  <li key={`${trophy.kind}-${trophy.cupId ?? 'championship'}-${trophy.year}`}>
                    <Link
                      className="inline-flex items-center gap-2 text-foreground hover:underline"
                      data-testid={`squad-history-trophy-${trophy.year}-${trophy.cupId ?? 'championship'}`}
                      to={trophy.sportLeagueId === null
                        ? buildLeagueChampionshipsPath(leagueCode, trophy.year)
                        : buildLeaguePointsRacePath(leagueCode, trophy.year, trophy.sportLeagueId)}
                    >
                      <Trophy aria-hidden className={isChampionshipTrophy(trophy) ? 'text-primary' : 'text-muted-foreground'} size={16} />
                      {describeSquadTrophy(trophy)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="squad-history-trophies-none">
                No trophies yet. A podium finish in a crowned cup or a finished championship puts one here.
              </p>
            )}
          </Tile>

          {placedYears.length ? (
            <Tile className="space-y-2" padding="sm" radius="lg">
              <h2 className="text-lg font-semibold text-foreground">All years</h2>
              <ul className="space-y-1 text-sm" data-testid="squad-history-years">
                {placedYears.map((row) => {
                  const line = describeSquadYearLine(row, currentYear);
                  return (
                    <li key={row.year}>
                      <Button
                        aria-pressed={row.year === year}
                        className="h-auto w-full flex-wrap justify-between gap-2 px-0 text-left font-normal"
                        data-testid={`squad-history-year-${row.year}`}
                        onClick={() => chooseYear(row.year)}
                        type="button"
                        variant="ghost"
                      >
                        <span className="font-semibold text-foreground">{line.title}</span>
                        <span className="text-muted-foreground">{line.detail}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Tile>
          ) : null}
        </>
      )}
    </section>
  );
}
