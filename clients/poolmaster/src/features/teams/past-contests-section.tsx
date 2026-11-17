import { useSearchParams } from 'react-router';
import { ChampionshipContestList } from '@/features/championships/championship-contest-list';
import { SquadFinishShown } from '@/features/championships/championship-view';
import { useChampionshipContestsQuery } from '@/features/championships/use-championship-query';
import { chooseContestHistoryYear } from '@/features/contests/contest-history';
import { useContestFinishedYearsQuery } from '@/features/contests/use-league-contests-query';
import { PAST_CONTESTS_PARAMS, buildLeagueTeamPastContestsPath } from '@/features/leagues/league-routing';
import { ErrorState, LoadingState, SectionCard, SectionEmpty, YearPicker } from '@/features/shared/ui';

/** How many of the newest past contests My team shows before All. */
const LATEST_PAST_CONTESTS = 3;

/**
 * My team's Past contests (#1763), moved from Contests › Past: the contests the viewer's team
 * finished, newest first, each with its place, opening the contest page. The latest few show;
 * All (`?past=all`) opens the whole list here, a year at a time (`?pastYear=`, the newest by
 * default). `?focus=` tints and scrolls to the contest a final contest's breadcrumb came from.
 */
export function PastContestsSection({
  leagueCode,
  leagueId,
  squadId,
}: {
  leagueCode: string;
  leagueId: string;
  squadId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const showAll = searchParams.get(PAST_CONTESTS_PARAMS.all) === 'all';
  const yearsQuery = useContestFinishedYearsQuery(leagueId);
  const years = yearsQuery.data ?? [];
  const year = chooseContestHistoryYear(years, showAll ? searchParams.get(PAST_CONTESTS_PARAMS.year) : null);
  // Every finished contest of the year with the team's finish on it (#1570), so a contest that
  // did not count still shows; the ones the team was not in are left out below.
  const resultsQuery = useChampionshipContestsQuery(leagueId, year, null, squadId);
  // The year's results narrowed to the ones the team finished in (#1763).
  const finished = (resultsQuery.data ?? []).filter((contest) => contest.squadFinish);
  const shown = showAll ? finished : finished.slice(0, LATEST_PAST_CONTESTS);
  // All only when it would show more: a contest past the latest few, or another year.
  const hasMore = finished.length > LATEST_PAST_CONTESTS || years.length > 1;
  const chooseYear = (next: number) => setSearchParams((current) => {
    const params = new URLSearchParams(current);
    params.set(PAST_CONTESTS_PARAMS.year, String(next));
    params.delete(PAST_CONTESTS_PARAMS.focus);
    return params;
  }, { replace: true });

  return (
    <SectionCard
      footer={showAll || !hasMore ? undefined : { label: 'All', testId: 'my-team-past-contests-all', to: buildLeagueTeamPastContestsPath(leagueCode) }}
      testId="my-team-past-contests"
      title="Past contests"
      trailing={showAll && year !== null && years.length > 1 ? (
        <YearPicker onChange={chooseYear} testId="my-team-past-contests-year" value={year} years={years} />
      ) : null}
    >
      {yearsQuery.isError ? (
        <ErrorState body="We couldn't load your past contests." onRetry={() => void yearsQuery.refetch()} size="inline" testId="my-team-past-contests-error" />
      ) : yearsQuery.isLoading ? (
        <LoadingState body="Loading your past contests..." rows={3} size="inline" />
      ) : year === null ? (
        <SectionEmpty testId="my-team-past-contests-none">No finished contests yet.</SectionEmpty>
      ) : resultsQuery.isError ? (
        <ErrorState body={`We couldn't load the contests finished in ${String(year)}.`} onRetry={() => void resultsQuery.refetch()} size="inline" testId="my-team-past-contests-error" />
      ) : !resultsQuery.data ? (
        <LoadingState body="Loading your past contests..." rows={3} size="inline" />
      ) : (
        <ChampionshipContestList
          contests={shown}
          emptyBody={`Your team didn't finish a contest in ${String(year)}.`}
          finishShown={SquadFinishShown.PLACE}
          focusContestId={searchParams.get(PAST_CONTESTS_PARAMS.focus)}
          leagueCode={leagueCode}
          testIdPrefix="my-team-past-contest"
        />
      )}
    </SectionCard>
  );
}
