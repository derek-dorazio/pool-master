import { Navigate, useParams } from 'react-router';
import { buildLeagueAdminTeamPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LoadingState } from '@/features/shared/ui';
import { EditTeamForm } from './edit-team-form';
import { useLeagueSquadQuery } from './use-league-squad-query';

/** Commissioner tools › Teams › one team › Edit. */
export function AdminEditTeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const teamQuery = useLeagueSquadQuery(league?.id ?? '', teamId);
  const managePath = buildLeagueAdminTeamPath(leagueCode, teamId);

  if (!league) {
    return null;
  }
  if (teamQuery.isLoading) {
    return <LoadingState body="Loading this member..." />;
  }

  const team = teamQuery.data;
  // A missing, inactive or read-only team goes back to its page, which says why.
  if (!team || !team.isActive || !league.isActive) {
    return <Navigate replace to={managePath} />;
  }

  return <EditTeamForm isViewerOwn={false} key={team.id} leagueCode={leagueCode} leagueId={league.id} returnTo={managePath} team={team} />;
}
