import type {
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import type { FastifyBaseLogger } from 'fastify';
import { SquadMembershipStatus, SquadOwnerInvitationStatus } from '@poolmaster/shared/domain';

interface DeactivateSquadMembershipForLeagueMemberInput {
  leagueId: string;
  userId: string;
  squadRepo: SquadRepository;
  squadMembershipRepo: SquadMembershipRepository;
  logger?: FastifyBaseLogger;
}

/**
 * Ends a league member's ownership of their team, and inactivates the team when they were its last
 * owner. Returns the id of the team it inactivated, or null. A caller that leaves that team
 * inactive closes its pending invitations with `revokePendingOwnerInvitations`.
 */
export async function deactivateSquadMembershipForLeagueMember(
  input: DeactivateSquadMembershipForLeagueMemberInput,
): Promise<string | null> {
  input.logger?.debug({
    action: 'squadMembership.deactivateForLeagueMember.enter',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Deactivating squad membership for league member');
  const membership = await input.squadMembershipRepo.findByLeagueAndUser(input.leagueId, input.userId);
  if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
    input.logger?.warn({
      action: 'squadMembership.deactivateForLeagueMember.skipped',
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        reason: membership ? `status:${membership.status}` : 'membership_missing',
      },
    }, 'Skipped squad membership deactivation');
    return null;
  }

  await input.squadMembershipRepo.update(membership.id, {
    status: SquadMembershipStatus.INACTIVE,
  });

  const remainingOwners = await input.squadMembershipRepo.findBySquad(membership.squadId);
  if (remainingOwners.length === 0) {
    await input.squadRepo.update(membership.squadId, {
      isActive: false,
    });
    input.logger?.info({
      action: 'squadMembership.deactivateForLeagueMember.squadInactivated',
      data: { leagueId: input.leagueId, userId: input.userId, squadId: membership.squadId },
    }, 'Inactivated squad after final owner left');
    return membership.squadId;
  }
  input.logger?.info({
    action: 'squadMembership.deactivateForLeagueMember.success',
    data: {
      leagueId: input.leagueId,
      userId: input.userId,
      squadId: membership.squadId,
      remainingOwners: remainingOwners.length,
    },
  }, 'Deactivated squad membership for league member');
  return null;
}

/**
 * Revokes a team's pending co-owner invitations. An inactive team's invitations can no longer be
 * accepted, and a pending one still blocks its address from an invitation to any other team in the
 * league, so every path that leaves a team inactive closes them (#529).
 */
export async function revokePendingOwnerInvitations(input: {
  leagueId: string;
  squadId: string;
  ownerInvitationRepo: SquadOwnerInvitationRepository;
  logger?: FastifyBaseLogger;
}): Promise<void> {
  const pending = (await input.ownerInvitationRepo.findByLeague(input.leagueId)).filter(
    (invitation) =>
      invitation.squadId === input.squadId && invitation.status === SquadOwnerInvitationStatus.PENDING,
  );
  await Promise.all(
    pending.map(async (invitation) =>
      input.ownerInvitationRepo.update(invitation.id, { status: SquadOwnerInvitationStatus.REVOKED })),
  );
  input.logger?.info({
    action: 'squadOwnerInvitation.revokePendingForSquad.success',
    data: { leagueId: input.leagueId, squadId: input.squadId, revoked: pending.length },
  }, 'Revoked pending co-owner invitations for an inactive squad');
}
