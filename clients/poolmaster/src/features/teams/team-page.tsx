import { LeagueRole } from '@poolmaster/shared/domain';
import { Link, Navigate, useParams } from 'react-router';
import { formatUserName } from '@/features/account/user-name';
import { buildUserPath } from '@/features/account/user-routing';
import { SquadHistorySection } from '@/features/championships/squad-history-section';
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
 * Another team's page: read-only for every member, with its owners and its year in the
 * championship and cups (#872). The viewer's own team opens My team, and a commissioner manages a
 * team from Commissioner tools.
 */
export function TeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const { membersByUserId } = useLeagueMembersQuery(leagueId);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading this member...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }
  if (teamId === viewer.mySquadId) {
    return <Navigate replace to={buildLeagueTeamPath(leagueCode)} />;
  }
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading this member..." testId="team-page-loading" />;
  }
  if (teamsQuery.isError) {
    return <ErrorState body="We couldn't load this league's members." testId="team-page-error" title="Member unavailable" />;
  }

  const team = teamsQuery.data?.find((candidate) => candidate.id === teamId);
  if (!team) {
    return (
      <EmptyState
        action={<LinkButton to={buildLeagueTeamsPath(leagueCode)} variant="secondary">All members</LinkButton>}
        body="They may have left or been removed."
        testId="team-page-not-found"
        title="This member isn't in this league"
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
            Manage
          </LinkButton>
        ) : null}
      </div>

      <section className="space-y-3" data-testid="team-page-owners">
        <h2 className="title-card text-lg text-foreground">Owners</h2>
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
          <p className="text-sm text-muted-foreground">{team.name} has no owners.</p>
        )}
      </section>

      <SquadHistorySection leagueCode={leagueCode} leagueId={leagueId} squad={team} />
    </section>
  );
}
