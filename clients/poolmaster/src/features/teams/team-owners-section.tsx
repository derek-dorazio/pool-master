import type { SquadDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { useLeagueMembersQuery } from '@/features/leagues/use-league-members-query';
import { Alert } from '@/features/shared/ui';
import { MyTeamOwnersPanel } from './my-team-owners-panel';
import { getActiveOwners } from './team-directory';
import { useTeamOwnerInvitationsQuery } from './use-team-owner-invitations-query';
import type { MyTeamOwners } from './use-my-team-owners';

/**
 * A team's Owners section, the same on My team and on Commissioner tools › Manage team: the
 * co-owner invite, the owners with their actions, pending invites, and replace owner.
 */
export function TeamOwnersSection({
  canManageAnyTeam,
  isBusy,
  isInactiveLeague,
  leagueCode,
  leagueId,
  owners,
  team,
  testId,
}: {
  /** Whether the viewer is a commissioner or root admin, who may change owners' league roles. */
  canManageAnyTeam: boolean;
  isBusy: boolean;
  isInactiveLeague: boolean;
  leagueCode: string;
  leagueId: string;
  owners: MyTeamOwners;
  team: SquadDto;
  testId: string;
}) {
  const auth = useAuth();
  const { membersByUserId } = useLeagueMembersQuery(leagueId);
  const invitationsQuery = useTeamOwnerInvitationsQuery(leagueId);
  const activeMembers = getActiveOwners(team);
  const teamOwnerInvitations = (invitationsQuery.data ?? []).filter((invitation) => invitation.squadId === team.id);

  return (
    <section className="space-y-3" data-testid={testId}>
      <h2 className="text-lg font-semibold text-foreground">Owners</h2>
      {invitationsQuery.isError ? (
        <Alert
          data-testid={`${testId}-invitations-error`}
          title="Owner invitations are temporarily unavailable"
          tone="warning"
        >
          Active owners are still shown below, but this team&apos;s pending owner invitations
          could not be loaded right now.
        </Alert>
      ) : null}
      <MyTeamOwnersPanel
        activeMembers={activeMembers}
        canManageAnyTeam={canManageAnyTeam}
        canManageSelectedTeam
        isBusy={isBusy}
        isInactiveLeague={isInactiveLeague}
        isInactiveTeam={!team.isActive}
        leagueCode={leagueCode}
        leagueId={leagueId}
        leagueMembersByUserId={membersByUserId}
        owners={owners}
        selectedTeam={team}
        teamOwnerInvitations={teamOwnerInvitations}
        viewerUserId={auth.user?.id}
      />
    </section>
  );
}
