import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import { deactivateSquadMembershipForLeagueMember } from '../squads/owner-membership';

interface InactivateLeagueMemberUnitInput {
  leagueId: string;
  userId: string;
  membershipRepo: LeagueMembershipRepository;
  prisma: PrismaClient;
  squadRepo?: SquadRepository;
  squadMembershipRepo?: SquadMembershipRepository;
  logger?: FastifyBaseLogger;
}

export async function inactivateLeagueMemberUnit(
  input: InactivateLeagueMemberUnitInput,
): Promise<void> {
  input.logger?.debug({
    action: 'leagueMemberLifecycle.inactivate.enter',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Inactivating league member unit');
  const membership = await input.membershipRepo.findByLeagueAndUser(input.leagueId, input.userId);
  if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
    input.logger?.warn({
      action: 'leagueMemberLifecycle.inactivate.skipped',
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        reason: membership ? `status:${membership.status}` : 'membership_missing',
      },
    }, 'Skipped league member inactivation');
    return;
  }

  await input.membershipRepo.update(membership.id, {
    status: LeagueMembershipStatus.INACTIVE,
  });

  if (input.squadRepo && input.squadMembershipRepo) {
    await deactivateSquadMembershipForLeagueMember({
      leagueId: input.leagueId,
      userId: input.userId,
      squadRepo: input.squadRepo,
      squadMembershipRepo: input.squadMembershipRepo,
      logger: input.logger,
    });
  }

  const remainingActiveLeagueMemberships = await input.membershipRepo.findByUser(input.userId);
  if (remainingActiveLeagueMemberships.length > 0) {
    input.logger?.info({
      action: 'leagueMemberLifecycle.inactivate.membershipOnly',
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        remainingActiveLeagueMemberships: remainingActiveLeagueMemberships.length,
      },
    }, 'Inactivated league membership but preserved active user account');
    return;
  }

  const user = await input.prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isActive: true, isRootAdmin: true },
  });

  if (!user || !user.isActive || user.isRootAdmin) {
    input.logger?.info({
      action: 'leagueMemberLifecycle.inactivate.userPreserved',
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        reason: !user ? 'user_missing' : user.isRootAdmin ? 'root_admin' : 'already_inactive',
      },
    }, 'Preserved user account after league member inactivation');
    return;
  }

  await input.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { isActive: false },
    });

    await tx.refreshToken.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
  input.logger?.info({
    action: 'leagueMemberLifecycle.inactivate.userDeactivated',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Deactivated user account after final active league membership ended');
}
