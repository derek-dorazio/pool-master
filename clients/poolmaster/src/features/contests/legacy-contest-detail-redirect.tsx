import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { getContest, getLeague } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { ContestDetailPage } from './contest-detail-page';

function extractLeagueCodeFromState(state: unknown) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const candidate = state as { leagueCode?: unknown };
  if (typeof candidate.leagueCode !== 'string' || candidate.leagueCode.trim().length === 0) {
    return null;
  }

  return candidate.leagueCode.trim();
}

export function LegacyContestDetailRedirect() {
  const { contestId = '' } = useParams<{ contestId: string }>();
  const location = useLocation();
  const hintedLeagueCode = extractLeagueCodeFromState(location.state);

  const contestQuery = useQuery({
    queryKey: ['poolmaster', 'legacy-contest-route', contestId],
    queryFn: async () => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throw response.error ?? new Error('Contest detail response is missing data.');
      }

      return response.data.contest;
    },
    enabled: Boolean(contestId) && !hintedLeagueCode,
    retry: false,
  });

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'legacy-contest-route-league', contestQuery.data?.leagueId],
    queryFn: async () => {
      const response = await getLeague({ path: { id: contestQuery.data!.leagueId } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League response is missing league data.');
      }

      return response.data.league;
    },
    enabled: Boolean(contestQuery.data?.leagueId) && !hintedLeagueCode,
    retry: false,
  });

  const resolvedLeagueCode = hintedLeagueCode ?? leagueQuery.data?.leagueCode ?? null;

  if (resolvedLeagueCode) {
    return (
      <Navigate
        replace
        state={location.state}
        to={buildLeagueContestPath(resolvedLeagueCode, contestId)}
      />
    );
  }

  if (contestQuery.isLoading || leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">
          Redirecting to the canonical contest route...
        </p>
      </section>
    );
  }

  return <ContestDetailPage />;
}
