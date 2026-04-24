import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';
import { toSquadDto, toSquadMembershipDto } from '../../mappers/squads.mapper';
import { buildDefaultSquadName } from '../../core/user-name';
import { inactivateLeagueMemberUnit } from '../leagues/member-lifecycle';

interface CreateSquadInput {
  name?: string;
  iconKey?: TeamIconKey;
}

interface UpdateSquadInput {
  name?: string;
  iconKey?: TeamIconKey;
}

export class SquadService {
  constructor(
    private readonly squadRepo: SquadRepository,
    private readonly squadMembershipRepo: SquadMembershipRepository,
    private readonly leagueMembershipRepo: LeagueMembershipRepository,
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listSquads(leagueId: string, userId: string): Promise<SquadDto[]> {
    this.logger?.debug({
      action: 'squad.list.enter',
      data: { leagueId, userId },
    }, 'Listing squads');
    await this.requireActiveLeagueMembership(leagueId, userId);

    const squads = await this.squadRepo.findByLeague(leagueId, true);
    const result = await Promise.all(squads.map(async (squad) => this.loadSquadDto(squad.id)));
    this.logger?.info({
      action: 'squad.list.success',
      data: { leagueId, userId, squadCount: result.length },
    }, 'Listed squads');
    return result;
  }

  async getSquad(leagueId: string, squadId: string, userId: string): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.get.enter',
      data: { leagueId, squadId, userId },
    }, 'Loading squad');
    await this.requireActiveLeagueMembership(leagueId, userId);
    await this.requireLeagueScopedSquad(leagueId, squadId);
    const squad = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.get.success',
      data: { leagueId, squadId, userId },
    }, 'Loaded squad');
    return squad;
  }

  async createSquad(leagueId: string, userId: string, input: CreateSquadInput): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.create.enter',
      data: { leagueId, userId, hasName: Boolean(input.name?.trim()), iconKey: input.iconKey ?? null },
    }, 'Creating squad');
    await this.requireActiveLeagueMembership(leagueId, userId);
    await this.ensureUserCanJoinLeagueSquad(leagueId, userId);

    const user = await this.requireUser(userId);
    const squad = await this.squadRepo.create({
      leagueId,
      createdBy: userId,
      name: input.name?.trim() || buildDefaultSquadName(user.firstName, user.lastName),
      iconKey: input.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD,
      status: SquadStatus.ACTIVE,
    });

    await this.squadMembershipRepo.create({
      squadId: squad.id,
      leagueId,
      userId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const squadDto = await this.loadSquadDto(squad.id);
    this.logger?.info({
      action: 'squad.create.success',
      data: { leagueId, squadId: squad.id, userId },
    }, 'Created squad');
    return squadDto;
  }

  async updateSquad(
    leagueId: string,
    squadId: string,
    userId: string,
    input: UpdateSquadInput,
  ): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.update.enter',
      data: {
        leagueId,
        squadId,
        userId,
        updates: {
          nameChanged: input.name !== undefined,
          iconChanged: input.iconKey !== undefined,
        },
      },
    }, 'Updating squad');
    await this.requireSquadManager(leagueId, squadId, userId);
    await this.squadRepo.update(squadId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
    });
    const squad = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.update.success',
      data: { leagueId, squadId, userId },
    }, 'Updated squad');
    return squad;
  }

  async inactivateSquad(
    leagueId: string,
    squadId: string,
    userId: string,
  ): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.inactivate.enter',
      data: { leagueId, squadId, userId },
    }, 'Inactivating squad');
    await this.requireSquadManager(leagueId, squadId, userId);
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    if (squad.status === SquadStatus.INACTIVE) {
      this.logger?.warn({
        action: 'squad.inactivate.alreadyInactive',
        data: { leagueId, squadId, userId },
      }, 'Squad already inactive');
      return this.loadSquadDto(squadId);
    }

    const activeMemberships = await this.squadMembershipRepo.findBySquad(squadId);

    await Promise.all(
      activeMemberships.map(async (membership) =>
        inactivateLeagueMemberUnit({
          leagueId,
          userId: membership.userId,
          membershipRepo: this.leagueMembershipRepo,
          prisma: this.prisma,
          squadRepo: this.squadRepo,
          squadMembershipRepo: this.squadMembershipRepo,
          logger: this.logger,
        })),
    );

    const refreshedSquad = await this.squadRepo.findById(squadId);
    if (refreshedSquad?.status === SquadStatus.ACTIVE) {
      await this.squadRepo.update(squadId, { status: SquadStatus.INACTIVE });
    }

    const squadDto = await this.loadSquadDto(squadId);
    this.logger?.info({
      action: 'squad.inactivate.success',
      data: { leagueId, squadId, userId },
    }, 'Inactivated squad');
    return squadDto;
  }

  async addOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.addOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Adding squad owner');
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    await this.requireSquadManager(leagueId, squadId, actorUserId);
    await this.requireActiveLeagueMembership(leagueId, targetUserId);

    const existingLeagueMembership = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, targetUserId);
    if (existingLeagueMembership) {
      if (existingLeagueMembership.squadId !== squadId) {
        this.logger?.warn({
          action: 'squad.addOwner.conflict',
          data: { leagueId, squadId, actorUserId, targetUserId, existingSquadId: existingLeagueMembership.squadId },
        }, 'Cannot add owner who already belongs to another squad');
        throw new SquadOperationError(
          'User already belongs to another squad in this league',
          'SQUAD_MEMBERSHIP_CONFLICT',
        );
      }

      if (existingLeagueMembership.status === SquadMembershipStatus.ACTIVE) {
        this.logger?.info({
          action: 'squad.addOwner.alreadyActive',
          data: { leagueId, squadId, actorUserId, targetUserId },
        }, 'Owner already active in squad');
        return this.loadSquadMembershipDto(existingLeagueMembership);
      }

      const reactivated = await this.squadMembershipRepo.update(existingLeagueMembership.id, {
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
      if (squad.status !== SquadStatus.ACTIVE) {
        await this.squadRepo.update(squadId, { status: SquadStatus.ACTIVE });
      }
      this.logger?.info({
        action: 'squad.addOwner.reactivated',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Reactivated historical squad owner');
      return this.loadSquadMembershipDto(reactivated);
    }

    const created = await this.squadMembershipRepo.create({
      squadId,
      leagueId,
      userId: targetUserId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    const membershipDto = await this.loadSquadMembershipDto(created);
    this.logger?.info({
      action: 'squad.addOwner.success',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Added squad owner');
    return membershipDto;
  }

  async removeOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.removeOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Removing squad owner');
    await this.requireSquadManager(leagueId, squadId, actorUserId);
    const membership = await this.squadMembershipRepo.findBySquadAndUser(squadId, targetUserId);
    if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.removeOwner.notFound',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Cannot remove missing active squad owner');
      throw new SquadNotFoundError(`Active squad membership not found for user ${targetUserId}`);
    }

    const activeMemberships = (await this.squadMembershipRepo.findBySquad(squadId)).filter(
      (item) => item.status === SquadMembershipStatus.ACTIVE,
    );
    if (activeMemberships.length <= 1) {
      this.logger?.warn({
        action: 'squad.removeOwner.requiresMultipleOwners',
        data: { leagueId, squadId, actorUserId, targetUserId },
      }, 'Rejected remove owner because the team only has one active owner');
      throw new SquadOperationError(
        'This team only has one active owner. Inactivate the team instead.',
        'SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS',
      );
    }

    const updated = await this.squadMembershipRepo.update(membership.id, {
      status: SquadMembershipStatus.INACTIVE,
    });

    const remaining = await this.squadMembershipRepo.findBySquad(squadId);
    if (remaining.length === 0) {
      await this.squadRepo.update(squadId, { status: SquadStatus.INACTIVE });
    }

    const membershipDto = await this.loadSquadMembershipDto(updated);
    this.logger?.info({
      action: 'squad.removeOwner.success',
      data: { leagueId, squadId, actorUserId, targetUserId, squadInactivated: remaining.length === 0 },
    }, 'Removed squad owner');
    return membershipDto;
  }

  private async loadSquadDto(squadId: Promise<string> | string): Promise<SquadDto> {
    const resolvedSquadId = await squadId;
    const squad = await this.squadRepo.findById(resolvedSquadId);
    if (!squad) {
      throw new SquadNotFoundError(`Squad not found: ${resolvedSquadId}`);
    }
    const memberships = await this.squadMembershipRepo.findBySquad(resolvedSquadId, true);
    const users = memberships.length === 0
      ? []
      : await this.prisma.user.findMany({
        where: { id: { in: memberships.map((membership) => membership.userId) } },
        select: { id: true, firstName: true, lastName: true },
      });
    const userByUserId = new Map(users.map((user) => [user.id, user]));
    const memberDtos = memberships.map((membership) =>
      toSquadMembershipDto(
        membership,
        userByUserId.get(membership.userId)?.firstName,
        userByUserId.get(membership.userId)?.lastName,
      ),
    );
    const memberCount = memberships.filter(
      (membership) => membership.status === SquadMembershipStatus.ACTIVE,
    ).length;
    return toSquadDto(squad, memberCount, memberDtos);
  }

  private async loadSquadMembershipDto(membership: {
    id: string;
    squadId: string;
    leagueId: string;
    userId: string;
    status: SquadMembershipStatus;
    joinedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<SquadMembershipDto> {
    const user = await this.requireUser(membership.userId);
    return toSquadMembershipDto(membership, user.firstName, user.lastName);
  }

  private async requireLeagueScopedSquad(leagueId: string, squadId: string) {
    const squad = await this.squadRepo.findById(squadId);
    if (!squad || squad.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'squad.requireScoped.notFound',
        data: { leagueId, squadId },
      }, 'Requested squad was not found in league scope');
      throw new SquadNotFoundError(`Squad not found: ${squadId}`);
    }
    return squad;
  }

  private async requireActiveLeagueMembership(leagueId: string, userId: string) {
    const membership = await this.leagueMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.requireLeagueMembership.missing',
        data: {
          leagueId,
          userId,
          reason: membership ? `status:${membership.status}` : 'membership_missing',
        },
      }, 'Rejected squad action for non-active league member');
      throw new SquadOperationError(
        'You must be an active league member to manage squads',
        'LEAGUE_MEMBERSHIP_REQUIRED',
      );
    }
    return membership;
  }

  private async requireActiveSquadOwner(leagueId: string, squadId: string, userId: string) {
    await this.requireLeagueScopedSquad(leagueId, squadId);
    const membership = await this.squadMembershipRepo.findBySquadAndUser(squadId, userId);
    if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.requireOwner.missing',
        data: {
          leagueId,
          squadId,
          userId,
          reason: membership ? `status:${membership.status}` : 'membership_missing',
        },
      }, 'Rejected squad action for non-owner');
      throw new SquadOperationError(
        'You must be an active team owner to perform this action',
        'SQUAD_OWNER_REQUIRED',
      );
    }
    if (membership.leagueId !== leagueId) {
      this.logger?.warn({
        action: 'squad.requireOwner.leagueMismatch',
        data: { leagueId, squadId, userId, membershipLeagueId: membership.leagueId },
      }, 'Rejected squad action due to league mismatch');
      throw new SquadOperationError(
        'Squad membership does not match the requested league',
        'SQUAD_LEAGUE_MISMATCH',
      );
    }
    return membership;
  }

  private async requireSquadManager(leagueId: string, squadId: string, userId: string) {
    const leagueMembership = await this.requireActiveLeagueMembership(leagueId, userId);
    if (leagueMembership.role === LeagueRole.COMMISSIONER) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      this.logger?.debug({
        action: 'squad.requireManager.commissionerBypass',
        data: { leagueId, squadId, userId },
      }, 'Commissioner managing squad');
      return leagueMembership;
    }

    return this.requireActiveSquadOwner(leagueId, squadId, userId);
  }

  private async ensureUserCanJoinLeagueSquad(leagueId: string, userId: string): Promise<void> {
    const existing = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (existing && existing.status === SquadMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'squad.ensureJoinable.activeConflict',
        data: { leagueId, userId, squadId: existing.squadId },
      }, 'Rejected squad creation because user already belongs to an active squad');
      throw new SquadOperationError(
        'User already belongs to a squad in this league',
        'SQUAD_MEMBERSHIP_CONFLICT',
      );
    }
    if (existing && existing.status === SquadMembershipStatus.INACTIVE) {
      this.logger?.warn({
        action: 'squad.ensureJoinable.historyExists',
        data: { leagueId, userId, squadId: existing.squadId },
      }, 'Rejected squad creation because user already has squad history');
      throw new SquadOperationError(
        'User already has a squad history in this league',
        'SQUAD_HISTORY_EXISTS',
      );
    }
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) {
      this.logger?.warn({
        action: 'squad.requireUser.notFound',
        data: { userId },
      }, 'Cannot resolve squad owner user');
      throw new SquadOperationError(`User not found: ${userId}`, 'USER_NOT_FOUND');
    }
    return user;
  }
}

export class SquadOperationError extends Error {
  code: string;

  constructor(message: string, code = 'SQUAD_OPERATION_INVALID') {
    super(message);
    this.name = 'SquadOperationError';
    this.code = code;
  }
}

export class SquadNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SquadNotFoundError';
  }
}
