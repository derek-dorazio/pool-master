import type { PrismaClient } from '@prisma/client';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  SquadMembershipStatus,
  SquadStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';
import { toSquadDto, toSquadMembershipDto } from '../../mappers/squads.mapper';
import { buildDefaultSquadName } from '../../core/user-name';

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
  ) {}

  async listSquads(leagueId: string, userId: string): Promise<SquadDto[]> {
    await this.requireActiveLeagueMembership(leagueId, userId);

    const squads = await this.squadRepo.findByLeague(leagueId, true);
    return Promise.all(squads.map(async (squad) => this.loadSquadDto(squad.id)));
  }

  async getSquad(leagueId: string, squadId: string, userId: string): Promise<SquadDto> {
    await this.requireActiveLeagueMembership(leagueId, userId);
    await this.requireLeagueScopedSquad(leagueId, squadId);
    return this.loadSquadDto(squadId);
  }

  async createSquad(leagueId: string, userId: string, input: CreateSquadInput): Promise<SquadDto> {
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

    return this.loadSquadDto(squad.id);
  }

  async updateSquad(
    leagueId: string,
    squadId: string,
    userId: string,
    input: UpdateSquadInput,
  ): Promise<SquadDto> {
    await this.requireActiveSquadOwner(leagueId, squadId, userId);
    await this.squadRepo.update(squadId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
    });
    return this.loadSquadDto(squadId);
  }

  async addOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<SquadMembershipDto> {
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    await this.requireActiveSquadOwner(leagueId, squadId, actorUserId);
    await this.requireActiveLeagueMembership(leagueId, targetUserId);

    const existingLeagueMembership = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, targetUserId);
    if (existingLeagueMembership) {
      if (existingLeagueMembership.squadId !== squadId) {
        throw new SquadOperationError(
          'User already belongs to another squad in this league',
          'SQUAD_MEMBERSHIP_CONFLICT',
        );
      }

      if (existingLeagueMembership.status === SquadMembershipStatus.ACTIVE) {
        return this.loadSquadMembershipDto(existingLeagueMembership);
      }

      const reactivated = await this.squadMembershipRepo.update(existingLeagueMembership.id, {
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
      });
      if (squad.status !== SquadStatus.ACTIVE) {
        await this.squadRepo.update(squadId, { status: SquadStatus.ACTIVE });
      }
      return this.loadSquadMembershipDto(reactivated);
    }

    const created = await this.squadMembershipRepo.create({
      squadId,
      leagueId,
      userId: targetUserId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });
    return this.loadSquadMembershipDto(created);
  }

  async removeOwner(
    leagueId: string,
    squadId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<SquadMembershipDto> {
    await this.requireActiveSquadOwner(leagueId, squadId, actorUserId);
    const membership = await this.squadMembershipRepo.findBySquadAndUser(squadId, targetUserId);
    if (!membership || membership.status !== SquadMembershipStatus.ACTIVE) {
      throw new SquadNotFoundError(`Active squad membership not found for user ${targetUserId}`);
    }

    const updated = await this.squadMembershipRepo.update(membership.id, {
      status: SquadMembershipStatus.INACTIVE,
    });

    const remaining = await this.squadMembershipRepo.findBySquad(squadId);
    if (remaining.length === 0) {
      await this.squadRepo.update(squadId, { status: SquadStatus.INACTIVE });
    }

    return this.loadSquadMembershipDto(updated);
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
      throw new SquadNotFoundError(`Squad not found: ${squadId}`);
    }
    return squad;
  }

  private async requireActiveLeagueMembership(leagueId: string, userId: string) {
    const membership = await this.leagueMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
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
      throw new SquadOperationError(
        'You must be an active team owner to perform this action',
        'SQUAD_OWNER_REQUIRED',
      );
    }
    if (membership.leagueId !== leagueId) {
      throw new SquadOperationError(
        'Squad membership does not match the requested league',
        'SQUAD_LEAGUE_MISMATCH',
      );
    }
    return membership;
  }

  private async ensureUserCanJoinLeagueSquad(leagueId: string, userId: string): Promise<void> {
    const existing = await this.squadMembershipRepo.findByLeagueAndUser(leagueId, userId);
    if (existing && existing.status === SquadMembershipStatus.ACTIVE) {
      throw new SquadOperationError(
        'User already belongs to a squad in this league',
        'SQUAD_MEMBERSHIP_CONFLICT',
      );
    }
    if (existing && existing.status === SquadMembershipStatus.INACTIVE) {
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
