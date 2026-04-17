import type { PrismaClient } from '@prisma/client';
import type { SquadMembershipRepository, SquadRepository } from '@poolmaster/shared/db';
import type { Squad } from '@poolmaster/shared/domain';
import { SquadMembershipStatus, SquadStatus, TeamIconKey } from '@poolmaster/shared/domain';
import { buildDefaultSquadName } from '../../core/user-name';

interface EnsureDefaultSquadForLeagueMemberInput {
  leagueId: string;
  userId: string;
  squadRepo: SquadRepository;
  squadMembershipRepo: SquadMembershipRepository;
  prisma: PrismaClient;
}

export async function ensureDefaultSquadForLeagueMember(
  input: EnsureDefaultSquadForLeagueMemberInput,
): Promise<Squad> {
  const existingMembership = await input.squadMembershipRepo.findByLeagueAndUser(
    input.leagueId,
    input.userId,
  );

  if (existingMembership?.status === SquadMembershipStatus.ACTIVE) {
    const existingSquad = await input.squadRepo.findById(existingMembership.squadId);
    if (!existingSquad) {
      throw new DefaultSquadProvisioningError(
        'Active team membership points to a missing team',
        'SQUAD_MEMBERSHIP_ORPHANED',
      );
    }
    return existingSquad;
  }

  const user = await input.prisma.user.findUnique({
    where: { id: input.userId },
    select: { firstName: true, lastName: true },
  });

  if (!user?.firstName || !user?.lastName) {
    throw new DefaultSquadProvisioningError(
      'Unable to resolve the team owner name',
      'SQUAD_OWNER_RESOLUTION_FAILED',
    );
  }

  const existingSquad = existingMembership
    ? await input.squadRepo.findById(existingMembership.squadId)
    : null;

  if (existingMembership && existingSquad) {
    if (existingSquad.status !== SquadStatus.ACTIVE) {
      await input.squadRepo.update(existingSquad.id, {
        status: SquadStatus.ACTIVE,
      });
    }

    await input.squadMembershipRepo.update(existingMembership.id, {
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const reloadedSquad = await input.squadRepo.findById(existingSquad.id);
    if (!reloadedSquad) {
      throw new DefaultSquadProvisioningError(
        'Unable to reload the reactivated team',
        'SQUAD_RELOAD_FAILED',
      );
    }
    return reloadedSquad;
  }

  const createdSquad = await input.squadRepo.create({
    leagueId: input.leagueId,
    createdBy: input.userId,
    name: buildDefaultSquadName(user.firstName, user.lastName),
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    status: SquadStatus.ACTIVE,
  });

  if (existingMembership) {
    await input.squadMembershipRepo.update(existingMembership.id, {
      squadId: createdSquad.id,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    return createdSquad;
  }

  await input.squadMembershipRepo.create({
    squadId: createdSquad.id,
    leagueId: input.leagueId,
    userId: input.userId,
    status: SquadMembershipStatus.ACTIVE,
    joinedAt: new Date(),
  });

  return createdSquad;
}

export class DefaultSquadProvisioningError extends Error {
  code: string;

  constructor(message: string, code = 'SQUAD_PROVISIONING_FAILED') {
    super(message);
    this.name = 'DefaultSquadProvisioningError';
    this.code = code;
  }
}
