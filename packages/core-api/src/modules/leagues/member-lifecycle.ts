import type { PrismaClient } from '@prisma/client';
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
}

export async function inactivateLeagueMemberUnit(
  input: InactivateLeagueMemberUnitInput,
): Promise<void> {
  const membership = await input.membershipRepo.findByLeagueAndUser(input.leagueId, input.userId);
  if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
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
    });
  }

  const remainingActiveLeagueMemberships = await input.membershipRepo.findByUser(input.userId);
  if (remainingActiveLeagueMemberships.length > 0) {
    return;
  }

  const user = await input.prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isActive: true, isRootAdmin: true },
  });

  if (!user || !user.isActive || user.isRootAdmin) {
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
}
