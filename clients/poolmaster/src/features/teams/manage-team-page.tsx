import { SquadMembershipStatus } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import {
  buildLeagueAdminTeamEditPath,
  buildLeagueAdminTeamsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import {
  Alert,
  Button,
  DangerZone,
  DangerZoneAction,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
  SettingsRow,
  SettingsSection,
} from '@/features/shared/ui';
import { MyTeamLifecycleDialogs, MyTeamLifecycleNotices } from './my-team-lifecycle';
import { MyTeamOwnersPanel } from './my-team-owners-panel';
import type { ActiveTeamDialog } from './my-team-shared';
import { TeamIcon } from './team-icon';
import { getTeamIconOption } from './team-icon-catalog';
import { useLeagueSquadsQuery } from './use-league-squads-query';
import { useMyTeamLifecycle } from './use-my-team-lifecycle';
import { useMyTeamOwners } from './use-my-team-owners';
import { useTeamOwnerInvitationsQuery } from './use-team-owner-invitations-query';

/** Commissioner tools › Teams › one team: its settings, owners and lifecycle. */
export function ManageTeamPage() {
  const { leagueCode = '', teamId = '' } = useParams<{ leagueCode: string; teamId: string }>();
  const auth = useAuth();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const { membersByUserId } = useLeagueMembersQuery(leagueId);
  const invitationsQuery = useTeamOwnerInvitationsQuery(leagueId);
  const team = teamsQuery.data?.find((candidate) => candidate.id === teamId) ?? null;
  const teamsPath = buildLeagueAdminTeamsPath(leagueCode);

  const [activeDialog, setActiveDialog] = useState<ActiveTeamDialog>(null);
  const owners = useMyTeamOwners({ leagueCode, leagueId, selectedTeam: team });
  const lifecycle = useMyTeamLifecycle({
    afterDeletePath: teamsPath,
    leagueCode,
    leagueId,
    resetOwnerForms: owners.resetOwnerForms,
    selectedTeam: team,
    setActiveDialog,
  });

  if (!league) {
    return null;
  }
  if (teamsQuery.isLoading) {
    return <LoadingState body="Loading team..." testId="manage-team-loading" />;
  }
  if (teamsQuery.isError) {
    return <ErrorState body="We couldn't load this league's teams." title="Team unavailable" />;
  }
  if (!team) {
    return (
      <EmptyState
        action={<LinkButton to={teamsPath} variant="secondary">All teams</LinkButton>}
        body="It may have been deleted."
        testId="manage-team-not-found"
        title="This team isn't in this league"
      />
    );
  }

  const isInactiveLeague = !league.isActive;
  const isInactiveTeam = !team.isActive;
  const isBusy = owners.isPending || lifecycle.isPending;
  const activeMembers = (team.members ?? []).filter((member) => member.status === SquadMembershipStatus.ACTIVE);
  const teamOwnerInvitations = (invitationsQuery.data ?? []).filter((invitation) => invitation.squadId === team.id);
  const iconLabel = getTeamIconOption(team.iconKey).label;

  return (
    <section className="space-y-8" data-testid="manage-team-page">
      <IdentityHeading
        icon={<TeamIcon iconKey={team.iconKey} size="md" />}
        meta={`${activeMembers.length} ${activeMembers.length === 1 ? 'owner' : 'owners'} · ${isInactiveTeam ? 'Inactive' : 'Active'}`}
        name={team.name}
        testId="manage-team-identity"
      />

      {isInactiveLeague ? (
        <Alert data-testid="manage-team-league-inactive" tone="warning">
          This league is inactive, so its teams are read-only.
        </Alert>
      ) : isInactiveTeam ? (
        <Alert data-testid="manage-team-inactive" tone="warning">
          This team is inactive. Inviting a former owner back restores it.
        </Alert>
      ) : null}

      <SettingsSection
        action={(
          <LinkButton
            data-testid="manage-team-edit"
            isDisabled={isInactiveLeague || isInactiveTeam}
            size="sm"
            to={buildLeagueAdminTeamEditPath(leagueCode, team.id)}
            variant="secondary"
          >
            Edit
          </LinkButton>
        )}
        testId="manage-team-general"
        title="Team"
      >
        <SettingsRow label="Name" value={team.name} />
        <SettingsRow label="Icon" value={iconLabel} />
      </SettingsSection>

      <section className="space-y-3" data-testid="manage-team-owners">
        <h2 className="text-lg font-semibold text-foreground">Owners</h2>
        {invitationsQuery.isError ? (
          <Alert
            data-testid="manage-team-invitations-error"
            title="Owner invitations are temporarily unavailable"
            tone="warning"
          >
            Active owners are still shown below, but this team&apos;s pending owner invitations
            could not be loaded right now.
          </Alert>
        ) : null}
        <MyTeamOwnersPanel
          activeMembers={activeMembers}
          canManageAnyTeam
          canManageSelectedTeam
          isBusy={isBusy}
          isInactiveLeague={isInactiveLeague}
          isInactiveTeam={isInactiveTeam}
          leagueCode={leagueCode}
          leagueId={leagueId}
          leagueMembersByUserId={membersByUserId}
          notices={null}
          owners={owners}
          selectedTeam={team}
          teamOwnerInvitations={teamOwnerInvitations}
          viewerUserId={auth.user?.id}
        />
      </section>

      <MyTeamLifecycleNotices lifecycle={lifecycle} />

      <DangerZone testId="manage-team-danger-zone">
        {isInactiveTeam ? (
          <DangerZoneAction
            action={(
              <Button
                data-testid="manage-team-delete"
                disabled={!viewer.isRootAdmin || isInactiveLeague || isBusy}
                onClick={() => setActiveDialog('delete')}
                variant="danger"
              >
                Delete team
              </Button>
            )}
            description={viewer.isRootAdmin
              ? 'Removes this inactive team for good.'
              : 'Only a root admin can delete a team.'}
            title="Delete team"
          />
        ) : (
          <DangerZoneAction
            action={(
              <Button
                data-testid="manage-team-inactivate"
                disabled={isInactiveLeague || isBusy}
                onClick={() => setActiveDialog('inactivate')}
                variant="danger"
              >
                Inactivate team
              </Button>
            )}
            description="Its owners leave the league. Their accounts and other leagues are untouched."
            title="Inactivate team"
          />
        )}
      </DangerZone>

      <MyTeamLifecycleDialogs
        activeDialog={activeDialog}
        lifecycle={lifecycle}
        selectedTeam={team}
        setActiveDialog={setActiveDialog}
      />
    </section>
  );
}
