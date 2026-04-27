/**
 * LeagueService — league creation, retrieval, and lifecycle management.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import type {
  League,
  LeagueMembership,
} from '@poolmaster/shared/domain';
import { JoinPolicy, LeagueIconKey, LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import { ensureDefaultSquadForLeagueMember } from '../squads/default-squad';

export interface CreateLeagueInput {
  createdBy: string;
  name: string;
  leagueCode: string;
  description?: string;
}

export interface UpdateLeagueDetailsInput {
  name: string;
  description?: string;
}

export interface UpdateLeagueIconInput {
  iconKey: LeagueIconKey;
}

export interface UserLeagueView {
  league: League;
  membership: LeagueMembership;
}

const DEFAULT_JOIN_POLICY = JoinPolicy.COMMISSIONER_ONLY;

export class LeagueService {
  constructor(
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
    private readonly prisma?: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Creates a new league and adds the creator as a commissioner. */
  async createLeague(input: CreateLeagueInput): Promise<{ league: League; membership: LeagueMembership }> {
    this.logger?.debug({
      action: 'league.create.enter',
      data: {
        createdBy: input.createdBy,
        leagueCode: input.leagueCode,
        hasDescription: Boolean(input.description?.trim()),
      },
    }, 'Creating league');
    const existingLeague = await this.leagueRepo.findByCode(input.leagueCode);
    if (existingLeague) {
      this.logger?.warn({
        action: 'league.create.conflict',
        data: {
          createdBy: input.createdBy,
          leagueCode: input.leagueCode,
          existingLeagueId: existingLeague.id,
        },
      }, 'Rejected duplicate league code');
      throw new LeagueCodeConflictError(input.leagueCode);
    }
    const league = await this.leagueRepo.create({
      leagueCode: input.leagueCode,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      isActive: true,
      iconKey: LeagueIconKey.TROPHY,
      joinPolicy: DEFAULT_JOIN_POLICY,
    });
    const membership = await this.membershipRepo.create({
      leagueId: league.id,
      userId: input.createdBy,
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    await this.ensureDefaultSquad(league.id, input.createdBy);

    this.logger?.info({
      action: 'league.create.success',
      data: {
        leagueId: league.id,
        membershipId: membership.id,
        createdBy: input.createdBy,
      },
    }, 'Created league with commissioner membership');

    return { league, membership };
  }

  async findById(leagueId: string): Promise<League | null> {
    return this.leagueRepo.findById(leagueId);
  }

  async findByCode(leagueCode: string): Promise<League | null> {
    return this.leagueRepo.findByCode(leagueCode.toUpperCase());
  }

  async findByUser(userId: string): Promise<UserLeagueView[]> {
    this.logger?.debug({
      action: 'league.findByUser.enter',
      data: { userId },
    }, 'Listing leagues for user');
    const memberships = await this.membershipRepo.findByUser(userId);
    const leagues = await Promise.all(
      memberships.map((membership) => this.leagueRepo.findById(membership.leagueId)),
    );
    const result = memberships.flatMap((membership, index) => {
      const league = leagues[index];
      if (!league) {
        this.logger?.warn({
          action: 'league.findByUser.membershipOrphaned',
          data: {
            userId,
            membershipId: membership.id,
            leagueId: membership.leagueId,
          },
        }, 'Skipped membership with missing league');
        return [];
      }

      return [{
        league,
        membership,
      }];
    });
    this.logger?.debug({
      action: 'league.findByUser.exit',
      data: {
        userId,
        membershipsFound: memberships.length,
        leaguesReturned: result.length,
      },
    }, 'Listed leagues for user');
    return result;
  }

  async inactivateLeague(leagueId: string): Promise<League> {
    this.logger?.debug({
      action: 'league.inactivate.enter',
      data: { leagueId },
    }, 'Inactivating league');
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.inactivate.notFound',
        data: { leagueId },
      }, 'Cannot inactivate missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      this.logger?.warn({
        action: 'league.inactivate.alreadyInactive',
        data: { leagueId },
      }, 'League already inactive');
      throw new LeagueOperationError(
        'League is already inactive',
        'LEAGUE_ALREADY_INACTIVE',
      );
    }

    const updatedLeague = await this.leagueRepo.update(leagueId, { isActive: false });
    this.logger?.info({
      action: 'league.inactivate.success',
      data: { leagueId },
    }, 'Inactivated league');
    return updatedLeague;
  }

  async activateLeague(leagueId: string): Promise<League> {
    this.logger?.debug({
      action: 'league.activate.enter',
      data: { leagueId },
    }, 'Activating league');
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.activate.notFound',
        data: { leagueId },
      }, 'Cannot activate missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive) {
      this.logger?.warn({
        action: 'league.activate.alreadyActive',
        data: { leagueId },
      }, 'League already active');
      throw new LeagueOperationError(
        'League is already active',
        'LEAGUE_ALREADY_ACTIVE',
      );
    }

    const updatedLeague = await this.leagueRepo.update(leagueId, { isActive: true });
    this.logger?.info({
      action: 'league.activate.success',
      data: { leagueId },
    }, 'Activated league');
    return updatedLeague;
  }

  async updateLeagueDetails(leagueId: string, updates: UpdateLeagueDetailsInput): Promise<League> {
    this.logger?.debug({
      action: 'league.updateDetails.enter',
      data: {
        leagueId,
        hasDescription: updates.description !== undefined,
      },
    }, 'Updating league details');
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.updateDetails.notFound',
        data: { leagueId },
      }, 'Cannot update details for missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      this.logger?.warn({
        action: 'league.updateDetails.readOnlyInactive',
        data: { leagueId },
      }, 'Rejected detail update for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }

    const updatedLeague = await this.leagueRepo.update(leagueId, {
      name: updates.name,
      description: updates.description?.trim() ? updates.description.trim() : undefined,
    });
    this.logger?.info({
      action: 'league.updateDetails.success',
      data: { leagueId },
    }, 'Updated league details');
    return updatedLeague;
  }

  async updateLeagueIcon(leagueId: string, updates: UpdateLeagueIconInput): Promise<League> {
    this.logger?.debug({
      action: 'league.updateIcon.enter',
      data: {
        leagueId,
        iconKey: updates.iconKey,
      },
    }, 'Updating league icon');
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.updateIcon.notFound',
        data: { leagueId },
      }, 'Cannot update icon for missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      this.logger?.warn({
        action: 'league.updateIcon.readOnlyInactive',
        data: { leagueId },
      }, 'Rejected icon update for inactive league');
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_ICON_READ_ONLY_WHEN_INACTIVE',
      );
    }

    const updatedLeague = await this.leagueRepo.update(leagueId, {
      iconKey: updates.iconKey,
    });
    this.logger?.info({
      action: 'league.updateIcon.success',
      data: {
        leagueId,
        iconKey: updates.iconKey,
      },
    }, 'Updated league icon');
    return updatedLeague;
  }

  async deleteInactiveLeague(leagueId: string, confirmationLeagueCode: string): Promise<void> {
    this.logger?.debug({
      action: 'league.delete.enter',
      data: { leagueId, confirmationLeagueCode },
    }, 'Deleting inactive league');
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      this.logger?.warn({
        action: 'league.delete.notFound',
        data: { leagueId },
      }, 'Cannot delete missing league');
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive) {
      this.logger?.warn({
        action: 'league.delete.requiresInactive',
        data: { leagueId },
      }, 'Rejected delete for active league');
      throw new LeagueOperationError(
        'League must be inactive before it can be permanently deleted',
        'LEAGUE_DELETE_REQUIRES_INACTIVE',
      );
    }

    if (league.leagueCode !== confirmationLeagueCode) {
      this.logger?.warn({
        action: 'league.delete.confirmationMismatch',
        data: { leagueId, confirmationLeagueCode },
      }, 'Rejected league delete due to confirmation mismatch');
      throw new LeagueOperationError(
        'League code confirmation must match exactly before permanent delete',
        'LEAGUE_DELETE_CONFIRMATION_MISMATCH',
      );
    }

    if (!this.prisma) {
      this.logger?.error({
        action: 'league.delete.prismaUnavailable',
        data: { leagueId },
      }, 'League deletion requires Prisma access');
      throw new LeagueOperationError(
        'League deletion is not configured correctly',
        'LEAGUE_DELETE_UNAVAILABLE',
        500,
      );
    }

    this.logger?.info({
      action: 'league.delete.transaction.start',
      data: { leagueId },
    }, 'Deleting league-owned records');
    await this.prisma.$transaction(async (tx) => {
      await tx.contestEntryParticipantScoreEvent.deleteMany({
        where: { participantScore: { entry: { contest: { leagueId } } } },
      });
      await tx.draftPickHistory.deleteMany({
        where: { session: { contest: { leagueId } } },
      });
      await tx.contestEntryParticipantScore.deleteMany({
        where: { entry: { contest: { leagueId } } },
      });
      await tx.contestEntryPrizeAward.deleteMany({
        where: { entry: { contest: { leagueId } } },
      });
      await tx.rosterPick.deleteMany({
        where: { entry: { contest: { leagueId } } },
      });
      await tx.contestEntry.deleteMany({
        where: { contest: { leagueId } },
      });
      await tx.draftSession.deleteMany({
        where: { contest: { leagueId } },
      });
      await tx.participantContestScoringRule.deleteMany({
        where: { contestConfiguration: { contest: { leagueId } } },
      });
      await tx.contestEntryAggregationRule.deleteMany({
        where: { contestConfiguration: { contest: { leagueId } } },
      });
      await tx.contestPrizeDefinition.deleteMany({
        where: { contestConfiguration: { contest: { leagueId } } },
      });
      await tx.contestConfiguration.deleteMany({
        where: { contest: { leagueId } },
      });
      await tx.contest.deleteMany({
        where: { leagueId },
      });
      await tx.commissionerActionItem.deleteMany({
        where: { leagueId },
      });
      await tx.commissionerAuditLog.deleteMany({
        where: { leagueId },
      });
      await tx.leagueInvitation.deleteMany({
        where: { leagueId },
      });
      await tx.squadMembership.deleteMany({
        where: { leagueId },
      });
      await tx.leagueMembership.deleteMany({
        where: { leagueId },
      });
      await tx.squad.deleteMany({
        where: { leagueId },
      });
      await tx.league.delete({
        where: { id: leagueId },
      });
    });
    this.logger?.info({
      action: 'league.delete.success',
      data: { leagueId },
    }, 'Deleted inactive league');
  }

  /** Returns the league together with its member list. */
  async getLeagueWithMembers(
    leagueId: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      return null;
    }
    const members = await this.membershipRepo.findByLeague(leagueId);
    return { league, members };
  }

  async getLeagueWithMembersByCode(
    leagueCode: string,
  ): Promise<{ league: League; members: LeagueMembership[] } | null> {
    const league = await this.findByCode(leagueCode);
    if (!league) {
      return null;
    }
    const members = await this.membershipRepo.findByLeague(league.id);
    return { league, members };
  }

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.squadRepo || !this.squadMembershipRepo || !this.prisma) {
      this.logger?.debug({
        action: 'league.ensureDefaultSquad.skipped',
        data: { leagueId, userId },
      }, 'Skipped default squad provisioning because dependencies are unavailable');
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
      prisma: this.prisma,
      logger: this.logger,
    });
  }

}

export class LeagueNotFoundError extends Error {
  constructor(leagueId: string) {
    super(`League not found: ${leagueId}`);
    this.name = 'LeagueNotFoundError';
  }
}

export class LeagueCodeConflictError extends Error {
  code = 'LEAGUE_CODE_CONFLICT';
  statusCode = 409;

  constructor(leagueCode: string) {
    super(`League code is already in use: ${leagueCode}`);
    this.name = 'LeagueCodeConflictError';
  }
}

export class LeagueOperationError extends Error {
  statusCode = 400;
  code: string;

  constructor(reason: string, code = 'LEAGUE_OPERATION_INVALID', statusCode = 400) {
    super(reason);
    this.name = 'LeagueOperationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
