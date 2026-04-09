import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { client, getLeague } from '@/lib/api';
import { FeedContainer } from '@/features/social/feed-container';
import type { LeagueDetailDto } from '@poolmaster/shared/dto';

function normalizeRole(role: string | undefined): string {
  return role?.toUpperCase() ?? '';
}

function isCommissionerRole(role: string | undefined): boolean {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === 'OWNER' || normalizedRole === 'COMMISSIONER';
}

function useLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: ['league', leagueId, 'feed'],
    enabled: Boolean(leagueId),
    queryFn: async (): Promise<LeagueDetailDto> => {
      const { data, error } = await getLeague({ client, path: { id: leagueId } });
      if (error) throw error;
      if (!data) {
        throw new Error('League feed shell response was empty.');
      }
      return data.league;
    },
  });
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const resolvedLeagueId = leagueId ?? '';
  const { data: league, isLoading, isError } = useLeagueDetail(resolvedLeagueId);

  if (!leagueId) {
    return (
      <div className="space-y-4" data-testid="league-feed-page">
        <h1 className="text-3xl font-bold">League Activity Feed</h1>
        <p role="alert" className="text-sm text-destructive" data-testid="league-feed-not-found">
          League not found.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="league-feed-page">
        <h1 className="text-3xl font-bold">League Activity Feed</h1>
        <p className="text-sm text-muted-foreground" data-testid="league-feed-loading">Loading league details...</p>
      </div>
    );
  }

  if (isError || !league) {
    return (
      <div className="space-y-4" data-testid="league-feed-page">
        <h1 className="text-3xl font-bold">League Activity Feed</h1>
        <p role="alert" className="text-sm text-destructive" data-testid="league-feed-error">
          Failed to load league details.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="league-feed-page">
      <h1 className="text-3xl font-bold">League Activity Feed</h1>
      <FeedContainer leagueId={resolvedLeagueId} isCommissioner={isCommissionerRole(league.role)} />
    </div>
  );
}
