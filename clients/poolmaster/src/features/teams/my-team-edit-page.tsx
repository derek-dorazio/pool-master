import { Navigate, useParams } from 'react-router-dom';
import { buildLeagueTeamPath } from '@/features/leagues/league-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LoadingState } from '@/features/shared/ui';
import { EditTeamForm } from './edit-team-form';
import { useLeagueSquadsQuery } from './use-league-squads-query';

/** My team › Edit team: the viewer's own team's name and icon, on one page with one Save. */
export function MyTeamEditPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const teamsQuery = useLeagueSquadsQuery(league?.id ?? '');
  const teamPath = buildLeagueTeamPath(leagueCode);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading your team...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading your team..." />;
  }

  const team = teamsQuery.data?.find((candidate) => candidate.id === viewer.mySquadId);
  // No team, an unloadable list, or a read-only league: My team says why.
  if (!team || !league.isActive) {
    return <Navigate replace to={teamPath} />;
  }

  return <EditTeamForm key={team.id} leagueId={league.id} returnTo={teamPath} team={team} />;
}
