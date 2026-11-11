import { LeagueRole } from '@poolmaster/shared/domain';
import { Navigate, useParams } from 'react-router';
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
import {
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  LinkButton,
  LoadingState,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
} from '@/features/shared/ui';
import { hasErrorCode } from '@/lib/errors';
import { formatOwnerCount, getActiveOwners } from './team-directory';
import { TeamAvatar } from './team-avatar';
import { useLeagueSquadQuery } from './use-league-squad-query';

/**
 * Another team's page: read-only for every member, with its owners and its year in the
 * championship and cups (#872). The viewer's own team opens My team, and a commissioner manages a
 * team from Commissioner tools.
 */
export function TeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamQuery = useLeagueSquadQuery(leagueId, teamId);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading this member...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }
  if (teamId === viewer.mySquadId) {
    return <Navigate replace to={buildLeagueTeamPath(leagueCode)} />;
  }
  if (teamQuery.isLoading) {
    return <LoadingState body="Loading this member..." testId="team-page-loading" />;
  }
  const team = teamQuery.data;
  if (teamQuery.isError && !hasErrorCode(teamQuery.error, 'SQUAD_NOT_FOUND')) {
    return <ErrorState onRetry={() => void teamQuery.refetch()} body="We couldn't load this member." testId="team-page-error" title="Member unavailable" />;
  }
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
      <PageHeader
        actions={viewer.isCommissioner || viewer.isRootAdmin ? (
          <LinkButton
            data-testid="team-page-manage"
            size="sm"
            to={buildLeagueAdminTeamPath(leagueCode, team.id)}
            variant="secondary"
          >
            Manage
          </LinkButton>
        ) : undefined}
        avatar={<TeamAvatar iconKey={team.iconKey} label={`${team.name} icon`} size="md" />}
        meta={`${formatOwnerCount(team)}${team.isActive ? '' : ' · Inactive'}`}
        testId="team-page-identity"
        title={team.name}
      />

      <SectionCard testId="team-page-owners" title="Owners">
        {owners.length ? (
          <SectionRows>
            {owners.map((owner) => (
              <SectionRow
                aside={owner.leagueRole === LeagueRole.COMMISSIONER ? <Chip>Commissioner</Chip> : null}
                key={owner.userId}
                name={formatUserName(owner.user.firstName, owner.user.lastName)}
                to={buildUserPath(owner.userId)}
              />
            ))}
          </SectionRows>
        ) : (
          <SectionEmpty>{team.name} has no owners.</SectionEmpty>
        )}
      </SectionCard>

      <SquadHistorySection leagueCode={leagueCode} leagueId={leagueId} squad={team} />
    </section>
  );
}
