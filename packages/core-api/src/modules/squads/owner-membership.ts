import type { SquadMembershipRepository, SquadRepository } from '@poolmaster/shared/db';
import type { FastifyBaseLogger } from 'fastify';
import { SquadMembershipStatus } from '@poolmaster/shared/domain';

interface DeactivateSquadMembershipForLeagueMemberInput {
  leagueId: string;
  userId: string;
  squadRepo: SquadRepository;
  squadMembershipRepo: SquadMembershipRepository;
  logger?: FastifyBaseLogger;
}

export async function deactivateSquadMembershipForLeagueMember(
  input: DeactivateSquadMembershipForLeagueMemberInput,
): Promise<void> {
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
    return;
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
    return;
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
}
