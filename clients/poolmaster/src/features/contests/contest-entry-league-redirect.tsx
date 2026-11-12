import { Navigate, useParams } from 'react-router';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { ErrorState, LoadingState, refetchFailed } from '@/features/shared/ui';
import { useContestQuery } from './use-contest-query';

/**
 * An entry's link without its league (`/contests/:contestId/entries/:entryId`), from before every
 * contest page lived under its league (#1393): reads the contest, then its league, and replaces
 * the URL with the entry's league address. Every contest page then knows its league from the URL.
 */
export function ContestEntryLeagueRedirect() {
  const { contestId = '', entryId = '' } = useParams<{ contestId: string; entryId: string }>();
  const contestQuery = useContestQuery(contestId);
  const { league, query: leagueQuery } = useLeagueContextById(contestQuery.data?.leagueId);

  if (contestQuery.isError || leagueQuery.isError) {
    return (
      <ErrorState
        body="We couldn't load this contest entry."
        onRetry={refetchFailed(contestQuery, leagueQuery)}
        testId="contest-entry-redirect-error"
      />
    );
  }
  if (!league) {
    return <LoadingState body="Loading contest entry..." />;
  }
  return <Navigate replace to={buildLeagueContestEntryPath(league.leagueCode, contestId, entryId)} />;
}
