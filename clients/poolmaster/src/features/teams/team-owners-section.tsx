import type { SquadDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { Alert, Heading } from '@/features/shared/ui';
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
  const invitationsQuery = useTeamOwnerInvitationsQuery(leagueId);
  const activeMembers = getActiveOwners(team);
  // poolmaster-allow-list-lookup: one league's co-owner invitations, one cached read shared by every team on the page
  const teamOwnerInvitations = (invitationsQuery.data ?? []).filter((invitation) => invitation.squadId === team.id);

  return (
    <section className="space-y-3" data-testid={testId}>
      <Heading level={2} variant="subtitle">Owners</Heading>
      {invitationsQuery.isError ? (
        <Alert
          data-testid={`${testId}-invitations-error`}
          title="Owner invitations are temporarily unavailable"
          tone="warning"
        >
          Active owners are still shown below, but pending owner invitations for {team.name}
          could not be loaded right now.
        </Alert>
      ) : null}
      <MyTeamOwnersPanel
        activeMembers={activeMembers}
        canManageAnyTeam={canManageAnyTeam}
        isBusy={isBusy}
        isInactiveLeague={isInactiveLeague}
        isInactiveTeam={!team.isActive}
        leagueCode={leagueCode}
        leagueId={leagueId}
        owners={owners}
        selectedTeam={team}
        teamOwnerInvitations={teamOwnerInvitations}
        viewerUserId={auth.user?.id}
      />
    </section>
  );
}
