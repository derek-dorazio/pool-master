import { useParams } from 'react-router';
import { useLeagueContextById } from '@/features/leagues/use-league-context';

/** A contest page's league code: the URL's, since every contest page lives under its league (#1393). */
export function useContestLeagueCode() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  return leagueCode;
}

/** A contest page's league code, and the viewer's place in its league from the league read. */
export function useContestLeague(leagueId: string | undefined) {
  const leagueCode = useContestLeagueCode();
  const { league, viewer } = useLeagueContextById(leagueId);
  return { league, leagueCode, viewer };
}
