import { useLeagueContextById } from '@/features/leagues/use-league-context';

/**
 * A contest page's league: the viewer's place in it, and its code, from the route's hint when
 * there is one, else from the league read once it lands (null until then).
 */
export function useContestLeague(leagueId: string | undefined, hintedLeagueCode: string | null) {
  const { league, viewer } = useLeagueContextById(leagueId);
  return { league, leagueCode: hintedLeagueCode ?? league?.leagueCode ?? null, viewer };
}
