import { PlanFeature, championshipYear } from '@poolmaster/shared/domain';
import { Trophy } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router';
import type { SquadDto } from '@/lib/api';
import { buildLeagueChampionshipsPath, buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { ErrorState, LoadingState, MetricGrid, MetricTile, SectionCard, SectionEmpty, SectionRow, SectionRows, YearPicker } from '@/features/shared/ui';
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
  const { pathname } = useLocation();
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

  const trophies = historyQuery.data?.trophies ?? [];
  return (
    <section className="space-y-6" data-testid="squad-history">
      <SectionCard
        bare
        title={historyYearTitle({ year, isOver: year < currentYear })}
        trailing={<YearPicker onChange={chooseYear} testId="squad-history-year" value={year} years={years} />}
      >
        <SquadYearSection key={year} leagueCode={leagueCode} leagueId={leagueId} mySquadId={viewer.mySquadId} squad={squad} year={year} />
      </SectionCard>

      {!hasShelf ? (
        <PlanLockedNotice feature={PlanFeature.TROPHY_SHELF} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />
      ) : historyQuery.isError ? (
        <ErrorState body="We couldn't load this squad's trophies and past years." testId="squad-history-error" />
      ) : !historyQuery.data ? (
        <LoadingState body="Loading this squad's trophies..." />
      ) : (
        <>
          <SectionCard
            info="A podium finish in a crowned cup or a finished championship, or a win in a contest the league runs every year, puts a trophy here."
            title="Trophy case"
          >
            <div className="p-4">
              <MetricGrid className="grid-cols-3">
                <div data-testid="squad-history-medal-firsts"><MetricTile label="Contest 1sts" value={historyQuery.data.medals.firsts} /></div>
                <div data-testid="squad-history-medal-seconds"><MetricTile label="Contest 2nds" value={historyQuery.data.medals.seconds} /></div>
                <div data-testid="squad-history-medal-thirds"><MetricTile label="Contest 3rds" value={historyQuery.data.medals.thirds} /></div>
              </MetricGrid>
            </div>
            {trophies.length || plates.length ? (
              <SectionRows testId="squad-history-trophies">
                {trophies.map((trophy) => (
                  <SectionRow
                    key={`${trophy.kind}-${trophy.cupId ?? 'championship'}-${trophy.year}`}
                    name={(
                      <>
                        <Trophy aria-hidden className={`mr-2 inline ${isChampionshipTrophy(trophy) ? 'text-primary' : 'text-muted-foreground'}`} size={16} />
                        {describeSquadTrophy(trophy)}
                      </>
                    )}
                    testId={`squad-history-trophy-${trophy.year}-${trophy.cupId ?? 'championship'}`}
                    to={trophy.sportLeagueId === null
                      ? buildLeagueChampionshipsPath(leagueCode, trophy.year)
                      : buildLeaguePointsRacePath(leagueCode, trophy.year, trophy.sportLeagueId)}
                  />
                ))}
                <SquadPerpetualPlates plates={plates} />
              </SectionRows>
            ) : (
              <SectionEmpty testId="squad-history-trophies-none">No trophies yet.</SectionEmpty>
            )}
          </SectionCard>

          {hasPlanFeature(league, PlanFeature.RECORD_BOOK) ? <SquadRecords leagueId={leagueId} squadId={squad.id} /> : null}

          {placedYears.length ? (
            <SectionCard title="All years">
              <SectionRows testId="squad-history-years">
                {placedYears.map((row) => {
                  const line = describeSquadYearLine(row, currentYear);
                  return (
                    <SectionRow
                      facts={line.detail}
                      isSelected={row.year === year}
                      key={row.year}
                      name={line.title}
                      testId={`squad-history-year-${row.year}`}
                      to={row.year === currentYear ? pathname : `${pathname}?year=${row.year}`}
                    />
                  );
                })}
              </SectionRows>
            </SectionCard>
          ) : null}
        </>
      )}
    </section>
  );
}
