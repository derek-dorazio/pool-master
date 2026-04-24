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
  TeamIconKey,
} from '@poolmaster/shared/domain';
import type { SquadDto, SquadMembershipDto } from '@poolmaster/shared/dto';
import { toSquadDto, toSquadMembershipDto } from '../../mappers/squads.mapper';
import { buildDefaultSquadName } from '../../core/user-name';
import { inactivateLeagueMemberUnit } from '../leagues/member-lifecycle';

interface SquadViewerContext {
  userId: string;
  isRootAdmin: boolean;
  teamRelationship: {
    leagueMember: boolean;
    commissioner: boolean;
  };
}

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

  async listSquads(leagueId: string, userId: string, isRootAdmin = false): Promise<SquadDto[]> {
    this.logger?.debug({
      action: 'squad.list.enter',
      data: { leagueId, userId },
    }, 'Listing squads');
    const viewerContext = await this.requireSquadViewerContext(leagueId, userId, isRootAdmin);

    const squads = await this.squadRepo.findByLeague(leagueId, true);
    const result = await Promise.all(
      squads.map(async (squad) => this.loadSquadDto(squad.id, viewerContext)),
    );
    this.logger?.info({
      action: 'squad.list.success',
      data: { leagueId, userId, squadCount: result.length },
    }, 'Listed squads');
    return result;
  }

  async getSquad(leagueId: string, squadId: string, userId: string, isRootAdmin = false): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.get.enter',
      data: { leagueId, squadId, userId },
    }, 'Loading squad');
    const viewerContext = await this.requireSquadViewerContext(leagueId, userId, isRootAdmin);
    await this.requireLeagueScopedSquad(leagueId, squadId);
    const squad = await this.loadSquadDto(squadId, viewerContext);
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
    const leagueMembership = await this.requireActiveLeagueMembership(leagueId, userId);
    await this.ensureUserCanJoinLeagueSquad(leagueId, userId);

    const user = await this.requireUser(userId);
    const squad = await this.squadRepo.create({
      leagueId,
      createdBy: userId,
      name: input.name?.trim() || buildDefaultSquadName(user.firstName, user.lastName),
      iconKey: input.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
    });

    await this.squadMembershipRepo.create({
      squadId: squad.id,
      leagueId,
      userId,
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const squadDto = await this.loadSquadDto(squad.id, {
      userId,
      isRootAdmin: false,
      teamRelationship: {
        leagueMember: true,
        commissioner: leagueMembership.role === LeagueRole.COMMISSIONER,
      },
    });
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
    isRootAdmin = false,
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
    const viewerContext = await this.requireSquadManager(leagueId, squadId, userId, isRootAdmin);
    await this.squadRepo.update(squadId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.iconKey !== undefined ? { iconKey: input.iconKey } : {}),
    });
    const squad = await this.loadSquadDto(squadId, viewerContext);
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
    isRootAdmin = false,
  ): Promise<SquadDto> {
    this.logger?.debug({
      action: 'squad.inactivate.enter',
      data: { leagueId, squadId, userId },
    }, 'Inactivating squad');
    const viewerContext = await this.requireSquadManager(leagueId, squadId, userId, isRootAdmin);
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    if (!squad.isActive) {
      this.logger?.warn({
        action: 'squad.inactivate.alreadyInactive',
        data: { leagueId, squadId, userId },
      }, 'Squad already inactive');
      return this.loadSquadDto(squadId, viewerContext);
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
    if (refreshedSquad?.isActive) {
      await this.squadRepo.update(squadId, { isActive: false });
    }

    const squadDto = await this.loadSquadDto(squadId, viewerContext);
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
    isRootAdmin = false,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.addOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Adding squad owner');
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    await this.requireSquadManager(leagueId, squadId, actorUserId, isRootAdmin);
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
      if (!squad.isActive) {
        await this.squadRepo.update(squadId, { isActive: true });
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
    isRootAdmin = false,
  ): Promise<SquadMembershipDto> {
    this.logger?.debug({
      action: 'squad.removeOwner.enter',
      data: { leagueId, squadId, actorUserId, targetUserId },
    }, 'Removing squad owner');
    await this.requireSquadManager(leagueId, squadId, actorUserId, isRootAdmin);
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
      await this.squadRepo.update(squadId, { isActive: false });
    }

    const membershipDto = await this.loadSquadMembershipDto(updated);
    this.logger?.info({
      action: 'squad.removeOwner.success',
      data: { leagueId, squadId, actorUserId, targetUserId, squadInactivated: remaining.length === 0 },
    }, 'Removed squad owner');
    return membershipDto;
  }

  async deleteInactiveSquad(
    leagueId: string,
    squadId: string,
    userId: string,
  ): Promise<void> {
    this.logger?.debug({
      action: 'squad.delete.enter',
      data: { leagueId, squadId, userId },
    }, 'Deleting inactive squad');
    const squad = await this.requireLeagueScopedSquad(leagueId, squadId);
    if (squad.isActive) {
      this.logger?.warn({
        action: 'squad.delete.requiresInactive',
        data: { leagueId, squadId, userId },
      }, 'Rejected squad delete because team is still active');
      throw new SquadOperationError(
        'Team must already be inactive before it can be permanently deleted.',
        'SQUAD_DELETE_REQUIRES_INACTIVE',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const entryIds = (
        await tx.contestEntry.findMany({
          where: { squadId },
          select: { id: true },
        })
      ).map((entry) => entry.id);

      const participantScoreIds = entryIds.length === 0
        ? []
        : (
            await tx.contestEntryParticipantScore.findMany({
              where: {
                entryId: { in: entryIds },
              },
              select: { id: true },
            })
          ).map((score) => score.id);

      if (participantScoreIds.length > 0) {
        await tx.contestEntryParticipantScoreEvent.deleteMany({
          where: {
            contestEntryParticipantScoreId: { in: participantScoreIds },
          },
        });
      }

      if (entryIds.length > 0) {
        await tx.contestEntryPrizeAward.deleteMany({
          where: {
            entryId: { in: entryIds },
          },
        });
        await tx.draftPickHistory.deleteMany({
          where: {
            entryId: { in: entryIds },
          },
        });
        await tx.contestEntryParticipantScore.deleteMany({
          where: {
            entryId: { in: entryIds },
          },
        });
        await tx.rosterPick.deleteMany({
          where: {
            entryId: { in: entryIds },
          },
        });
        await tx.contestEntry.deleteMany({
          where: {
            id: { in: entryIds },
          },
        });
      }

      await tx.squadOwnerInvitation.deleteMany({
        where: { squadId },
      });
      await tx.squadMembership.deleteMany({
        where: { squadId },
      });
      await tx.squad.delete({
        where: { id: squadId },
      });
    });

    this.logger?.info({
      action: 'squad.delete.success',
      data: { leagueId, squadId, userId },
    }, 'Deleted inactive squad');
  }

  private async loadSquadDto(
    squadId: Promise<string> | string,
    viewerContext: SquadViewerContext,
  ): Promise<SquadDto> {
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
    const teamRelationship = {
      ...viewerContext.teamRelationship,
      owner: memberships.some(
        (membership) =>
          membership.userId === viewerContext.userId && membership.status === SquadMembershipStatus.ACTIVE,
      ),
    };
    return toSquadDto(squad, memberCount, memberDtos, {
      teamRelationship,
      isRootAdmin: viewerContext.isRootAdmin,
    });
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

  private async requireSquadViewerContext(
    leagueId: string,
    userId: string,
    isRootAdmin: boolean,
  ): Promise<SquadViewerContext> {
    if (isRootAdmin) {
      const membership = await this.leagueMembershipRepo.findByLeagueAndUser(leagueId, userId);
      if (membership?.status === LeagueMembershipStatus.ACTIVE) {
        return {
          userId,
          isRootAdmin: true,
          teamRelationship: {
            leagueMember: true,
            commissioner: membership.role === LeagueRole.COMMISSIONER,
          },
        };
      }
      return {
        userId,
        isRootAdmin: true,
        teamRelationship: {
          leagueMember: false,
          commissioner: false,
        },
      };
    }

    const membership = await this.requireActiveLeagueMembership(leagueId, userId);
    return {
      userId,
      isRootAdmin: false,
      teamRelationship: {
        leagueMember: true,
        commissioner: membership.role === LeagueRole.COMMISSIONER,
      },
    };
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

  private async requireSquadManager(
    leagueId: string,
    squadId: string,
    userId: string,
    isRootAdmin: boolean,
  ): Promise<SquadViewerContext> {
    if (isRootAdmin) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      this.logger?.debug({
        action: 'squad.requireManager.rootAdminBypass',
        data: { leagueId, squadId, userId },
      }, 'Root admin managing squad');
      const membership = await this.leagueMembershipRepo.findByLeagueAndUser(leagueId, userId);
      return {
        userId,
        isRootAdmin: true,
        teamRelationship: {
          leagueMember: membership?.status === LeagueMembershipStatus.ACTIVE,
          commissioner:
            membership?.status === LeagueMembershipStatus.ACTIVE
            && membership.role === LeagueRole.COMMISSIONER,
        },
      };
    }

    const leagueMembership = await this.requireActiveLeagueMembership(leagueId, userId);
    if (leagueMembership.role === LeagueRole.COMMISSIONER) {
      await this.requireLeagueScopedSquad(leagueId, squadId);
      this.logger?.debug({
        action: 'squad.requireManager.commissionerBypass',
        data: { leagueId, squadId, userId },
      }, 'Commissioner managing squad');
      return {
        userId,
        isRootAdmin: false,
        teamRelationship: {
          leagueMember: true,
          commissioner: true,
        },
      };
    }

    await this.requireActiveSquadOwner(leagueId, squadId, userId);
    return {
      userId,
      isRootAdmin: false,
      teamRelationship: {
        leagueMember: true,
        commissioner: false,
      },
    };
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
