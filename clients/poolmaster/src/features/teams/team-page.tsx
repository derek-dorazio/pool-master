import { LeagueRole } from '@poolmaster/shared/domain';
import { Link, Navigate, useParams } from 'react-router-dom';
import { formatUserName } from '@/features/account/user-name';
import { buildUserPath } from '@/features/account/user-routing';
import {
  buildLeagueAdminTeamPath,
  buildLeagueTeamPath,
  buildLeagueTeamsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import {
  Chip,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
} from '@/features/shared/ui';
import { formatOwnerCount, getActiveOwners } from './team-directory';
import { TeamIcon } from './team-icon';
import { useLeagueSquadsQuery } from './use-league-squads-query';

/**
 * Another team's page: read-only for every member. The viewer's own team opens My team, and a
 * commissioner manages a team from Commissioner tools.
 */
export function TeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const { membersByUserId } = useLeagueMembersQuery(leagueId);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading team...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }
  if (teamId === viewer.mySquadId) {
    return <Navigate replace to={buildLeagueTeamPath(leagueCode)} />;
  }
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading team..." testId="team-page-loading" />;
  }
  if (teamsQuery.isError) {
    return <ErrorState body="We couldn't load this league's teams." testId="team-page-error" title="Team unavailable" />;
  }

  const team = teamsQuery.data?.find((candidate) => candidate.id === teamId);
  if (!team) {
    return (
      <EmptyState
        action={<LinkButton to={buildLeagueTeamsPath(leagueCode)} variant="secondary">All teams</LinkButton>}
        body="It may have been deleted."
        testId="team-page-not-found"
        title="This team isn't in this league"
      />
    );
  }

  const owners = getActiveOwners(team);

  return (
    <section className="space-y-8" data-testid="team-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <IdentityHeading
          icon={<TeamIcon iconKey={team.iconKey} size="md" />}
          meta={`${formatOwnerCount(team)}${team.isActive ? '' : ' · Inactive'}`}
          name={team.name}
          testId="team-page-identity"
        />
        {viewer.isCommissioner || viewer.isRootAdmin ? (
          <LinkButton
            data-testid="team-page-manage"
            size="sm"
            to={buildLeagueAdminTeamPath(leagueCode, team.id)}
            variant="secondary"
          >
            Manage team
          </LinkButton>
        ) : null}
      </div>

      <section className="space-y-3" data-testid="team-page-owners">
        <h2 className="text-lg font-semibold text-foreground">Owners</h2>
        {owners.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {owners.map((owner) => (
              <li className="flex flex-wrap items-center gap-2 px-4 py-3" key={owner.userId}>
                <Link className="font-medium text-foreground hover:underline" to={buildUserPath(owner.userId)}>
                  {formatUserName(owner.user.firstName, owner.user.lastName)}
                </Link>
                {membersByUserId.get(owner.userId)?.role === LeagueRole.COMMISSIONER ? <Chip>Commissioner</Chip> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">This team has no owners.</p>
        )}
      </section>
    </section>
  );
}
