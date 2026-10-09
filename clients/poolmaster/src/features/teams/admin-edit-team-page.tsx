import { Navigate, useParams } from 'react-router-dom';
import { buildLeagueAdminTeamPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LoadingState } from '@/features/shared/ui';
import { EditTeamForm } from './edit-team-form';
import { useLeagueSquadsQuery } from './use-league-squads-query';

/** Commissioner tools › Teams › one team › Edit. */
export function AdminEditTeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const teamsQuery = useLeagueSquadsQuery(league?.id ?? '');
  const managePath = buildLeagueAdminTeamPath(leagueCode, teamId);

  if (!league) {
    return null;
  }
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading team..." />;
  }

  const team = teamsQuery.data?.find((candidate) => candidate.id === teamId);
  // A missing, inactive or read-only team goes back to its page, which says why.
  if (!team || !team.isActive || !league.isActive) {
    return <Navigate replace to={managePath} />;
  }

  return <EditTeamForm key={team.id} leagueId={league.id} returnTo={managePath} team={team} />;
}
