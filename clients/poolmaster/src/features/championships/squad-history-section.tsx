import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { Trophy } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { SquadDto } from '@/lib/api';
import { buildLeagueChampionshipsPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { Button, ErrorState, LoadingState, MetricGrid, MetricTile, Select, Tile } from '@/features/shared/ui';
import { historyYearTitle } from './championship-view';
import { SquadPerpetualPlates } from './perpetual-trophies';
import { SquadRecords } from './record-book';
import { championshipYearsOffered, parseChampionshipYearParam } from './championship-year';
import { SquadYearSection } from './squad-year-section';
import { describeSquadTrophy, describeSquadYearLine, isChampionshipTrophy, squadYearsPlaced } from './squad-year-view';
import { platesWonBy } from './perpetual-trophy-view';
import { usePerpetualTrophiesQuery, useSquadHistoryQuery } from './use-championship-query';

/**
 * A squad's results on its squad page (#872, mockup E): the year picked (`?year=`, the current one
 * by default) with its championship, cups and contests; then its trophy case, with its contest
 * medals all time, every trophy it has won and its perpetual trophy plates; then the records it holds; then an All years
 * strip, one line per year it placed in, each opening that year here. On the league's plan
 * (#948): without the trophy shelf its trophy case is the locked note, without past years only
 * the current year shows, and without the record book no records.
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
  const { league, viewer } = useLeagueContext(leagueCode);
  const hasShelf = hasPlanFeature(league, PlanFeature.TROPHY_SHELF);
  const hasPastYears = hasPlanFeature(league, PlanFeature.PAST_YEARS);
  const currentYear = championshipYear(new Date());
  const year = hasPastYears ? parseChampionshipYearParam(searchParams.get('year') ?? undefined) ?? currentYear : currentYear;
  const historyQuery = useSquadHistoryQuery(hasShelf ? leagueId : '', squad.id);
  const years = championshipYearsOffered([year, ...(hasPastYears ? historyQuery.data?.years ?? [] : []).map((row) => row.year)], [], currentYear);
  const chooseYear = (next: number) => {
    setSearchParams(next === currentYear ? {} : { year: String(next) }, { replace: true });
  };
  const placedYears = hasPastYears ? squadYearsPlaced(historyQuery.data?.years ?? []) : [];
  const plates = platesWonBy(usePerpetualTrophiesQuery(hasShelf ? leagueId : '').data ?? [], squad.id);

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

      {!hasShelf ? (
        <PlanLockedNotice feature={PlanFeature.TROPHY_SHELF} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />
      ) : historyQuery.isError ? (
        <ErrorState body="We couldn't load this squad's trophies and past years." testId="squad-history-error" />
      ) : !historyQuery.data ? (
        <LoadingState body="Loading this squad's trophies..." />
      ) : (
        <>
          <Tile className="space-y-3" padding="sm" radius="lg">
            <h2 className="title-card text-lg text-foreground">Trophy case</h2>
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
            ) : null}
            <SquadPerpetualPlates plates={plates} />
            {!historyQuery.data.trophies.length && !plates.length ? (
              <p className="text-sm text-muted-foreground" data-testid="squad-history-trophies-none">
                No trophies yet. A podium finish in a crowned cup or a finished championship, or a win in a
                contest the league runs every year, puts one here.
              </p>
            ) : null}
          </Tile>

          {hasPlanFeature(league, PlanFeature.RECORD_BOOK) ? <SquadRecords leagueId={leagueId} squadId={squad.id} /> : null}

          {placedYears.length ? (
            <Tile className="space-y-2" padding="sm" radius="lg">
              <h2 className="title-card text-lg text-foreground">All years</h2>
              <ul className="space-y-1 text-sm" data-testid="squad-history-years">
                {placedYears.map((row) => {
                  const line = describeSquadYearLine(row, currentYear);
                  return (
                    <li key={row.year}>
                      <Button
                        aria-pressed={row.year === year}
                        className="min-h-0 flex-wrap justify-between gap-2 px-0 py-0 font-normal"
                        layout="row"
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
