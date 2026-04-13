/**
 * LeagueService — league creation, retrieval, and settings management.
 */

import type { PrismaClient } from '@prisma/client';
import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import type {
  League,
  LeagueMembership,
  LeagueSettings,
} from '@poolmaster/shared/domain';
import { InvitePolicy, LeagueMembershipStatus, LeagueRole, LeagueVisibility, WeekDay } from '@poolmaster/shared/domain';
import { ALL_COMMISSIONER_PERMISSIONS } from '../../core/permissions';

export interface CreateLeagueInput {
  createdBy: string;
  name: string;
  leagueCode: string;
  description?: string;
}

export interface UserLeagueView {
  league: League;
  membership: LeagueMembership;
}

const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  isActive: true,
  invitePolicy: InvitePolicy.COMMISSIONER_ONLY,
  allowMidSeasonJoin: false,
  requireApproval: false,
  activityFeedEnabled: true,
  weeklyRecapEnabled: false,
  weeklyRecapDay: WeekDay.MONDAY,
  timezone: 'America/New_York',
  currency: 'USD',
};

const DEFAULT_MAX_MEMBERS = 20;

export class LeagueService {
  constructor(
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly prisma?: PrismaClient,
  ) {}

  /** Creates a new league and adds the creator as a commissioner. */
  async createLeague(input: CreateLeagueInput): Promise<{ league: League; membership: LeagueMembership }> {
    const existingLeague = await this.leagueRepo.findByCode(input.leagueCode);
    if (existingLeague) {
      throw new LeagueCodeConflictError(input.leagueCode);
    }
    const league = await this.leagueRepo.create({
      leagueCode: input.leagueCode,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      visibility: LeagueVisibility.PRIVATE,
      maxMembers: DEFAULT_MAX_MEMBERS,
      settings: DEFAULT_LEAGUE_SETTINGS as unknown as Record<string, unknown>,
    });
    const membership = await this.membershipRepo.create({
      leagueId: league.id,
      userId: input.createdBy,
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
      permissions: [...ALL_COMMISSIONER_PERMISSIONS],
      joinedAt: new Date(),
    });
    return { league, membership };
  }

  async findById(leagueId: string): Promise<League | null> {
    return this.leagueRepo.findById(leagueId);
  }

  async findByCode(leagueCode: string): Promise<League | null> {
    return this.leagueRepo.findByCode(leagueCode.toUpperCase());
  }

  async findByUser(userId: string): Promise<UserLeagueView[]> {
    const memberships = await this.membershipRepo.findByUser(userId);
    const leagues = await Promise.all(
      memberships.map((membership) => this.leagueRepo.findById(membership.leagueId)),
    );
    return memberships.flatMap((membership, index) => {
      const league = leagues[index];
      if (!league) {
        return [];
      }

      return [{
        league,
        membership,
      }];
    });
  }

  /** Partially updates the league settings JSONB, merging with existing values. */
  async updateSettings(
    leagueId: string,
    updates: Partial<LeagueSettings>,
  ): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }
    const currentSettings = league.settings as unknown as LeagueSettings;
    const mergedSettings: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, ...currentSettings, ...updates };
    return this.leagueRepo.update(leagueId, {
      settings: mergedSettings as unknown as Record<string, unknown>,
    });
  }

  async inactivateLeague(leagueId: string): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    const currentSettings = league.settings as unknown as LeagueSettings;
    if (currentSettings?.isActive === false) {
      throw new LeagueOperationError(
        'League is already inactive',
        'LEAGUE_ALREADY_INACTIVE',
      );
    }

    return this.updateSettings(leagueId, { isActive: false });
  }

  async deleteInactiveLeague(leagueId: string, confirmationLeagueCode: string): Promise<void> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    const currentSettings = league.settings as unknown as LeagueSettings;
    if (currentSettings?.isActive ?? true) {
      throw new LeagueOperationError(
        'League must be inactive before it can be permanently deleted',
        'LEAGUE_DELETE_REQUIRES_INACTIVE',
      );
    }

    if (league.leagueCode !== confirmationLeagueCode) {
      throw new LeagueOperationError(
        'League code confirmation must match exactly before permanent delete',
        'LEAGUE_DELETE_CONFIRMATION_MISMATCH',
      );
    }

    if (!this.prisma) {
      throw new Error('LeagueService deleteInactiveLeague requires Prisma access');
    }

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

  constructor(reason: string, code = 'LEAGUE_OPERATION_INVALID') {
    super(reason);
    this.name = 'LeagueOperationError';
    this.code = code;
  }
}
