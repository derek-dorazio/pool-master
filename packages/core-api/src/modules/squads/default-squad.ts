import type { PrismaClient } from '@prisma/client';
import type { SquadMembershipRepository, SquadRepository } from '@poolmaster/shared/db';
import type { Squad } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import { SquadMembershipStatus, SquadStatus, TeamIconKey } from '@poolmaster/shared/domain';
import { buildDefaultSquadName } from '../../core/user-name';

interface EnsureDefaultSquadForLeagueMemberInput {
  leagueId: string;
  userId: string;
  squadRepo: SquadRepository;
  squadMembershipRepo: SquadMembershipRepository;
  prisma: PrismaClient;
  logger?: FastifyBaseLogger;
}

export async function ensureDefaultSquadForLeagueMember(
  input: EnsureDefaultSquadForLeagueMemberInput,
): Promise<Squad> {
  input.logger?.debug({
    action: 'squad.ensureDefault.enter',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Ensuring default squad for league member');
  const existingMembership = await input.squadMembershipRepo.findByLeagueAndUser(
    input.leagueId,
    input.userId,
  );

  if (existingMembership?.status === SquadMembershipStatus.ACTIVE) {
    const existingSquad = await input.squadRepo.findById(existingMembership.squadId);
    if (!existingSquad) {
      input.logger?.error({
        action: 'squad.ensureDefault.orphanedMembership',
        data: { leagueId: input.leagueId, userId: input.userId, squadId: existingMembership.squadId },
      }, 'Active squad membership points to missing squad');
      throw new DefaultSquadProvisioningError(
        'Active team membership points to a missing team',
        'SQUAD_MEMBERSHIP_ORPHANED',
      );
    }
    input.logger?.info({
      action: 'squad.ensureDefault.reusedActive',
      data: { leagueId: input.leagueId, userId: input.userId, squadId: existingSquad.id },
    }, 'Reused existing active squad membership');
    return existingSquad;
  }

  const user = await input.prisma.user.findUnique({
    where: { id: input.userId },
    select: { firstName: true, lastName: true },
  });

  if (!user?.firstName || !user?.lastName) {
    input.logger?.warn({
      action: 'squad.ensureDefault.userNameMissing',
      data: { leagueId: input.leagueId, userId: input.userId },
    }, 'Cannot provision default squad without owner name');
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
      input.logger?.error({
        action: 'squad.ensureDefault.reloadFailed',
        data: { leagueId: input.leagueId, userId: input.userId, squadId: existingSquad.id },
      }, 'Failed to reload reactivated squad');
      throw new DefaultSquadProvisioningError(
        'Unable to reload the reactivated team',
        'SQUAD_RELOAD_FAILED',
      );
    }
    input.logger?.info({
      action: 'squad.ensureDefault.reactivated',
      data: { leagueId: input.leagueId, userId: input.userId, squadId: reloadedSquad.id },
    }, 'Reactivated historical squad membership');
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
    input.logger?.info({
      action: 'squad.ensureDefault.reassignedHistoricalMembership',
      data: { leagueId: input.leagueId, userId: input.userId, squadId: createdSquad.id },
    }, 'Created default squad and reassigned historical membership');
    return createdSquad;
  }

  await input.squadMembershipRepo.create({
    squadId: createdSquad.id,
    leagueId: input.leagueId,
    userId: input.userId,
    status: SquadMembershipStatus.ACTIVE,
    joinedAt: new Date(),
  });

  input.logger?.info({
    action: 'squad.ensureDefault.created',
    data: { leagueId: input.leagueId, userId: input.userId, squadId: createdSquad.id },
  }, 'Created default squad and active ownership membership');
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
