import { Navigate, useParams } from 'react-router';
import { buildLeagueTeamPath } from '@/features/leagues/league-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { LoadingState } from '@/features/shared/ui';
import { EditTeamForm } from './edit-team-form';
import { useLeagueSquadQuery } from './use-league-squad-query';

/** My team › Edit team: the viewer's own team's name and icon, on one page with one Save. */
export function MyTeamEditPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const teamQuery = useLeagueSquadQuery(league?.id ?? '', viewer.mySquadId);
  const teamPath = buildLeagueTeamPath(leagueCode);

  const leagueContext = useLeagueContextGuard(leagueQuery);
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }
  if (teamQuery.isLoading) {
    return <LoadingState />;
  }

  const team = teamQuery.data;
  // No team, an unloadable team, or a read-only league: My team says why.
  if (!team || !league.isActive) {
    return <Navigate replace to={teamPath} />;
  }

  return <EditTeamForm isViewerOwn key={team.id} leagueCode={leagueCode} leagueId={league.id} returnTo={teamPath} team={team} />;
}
