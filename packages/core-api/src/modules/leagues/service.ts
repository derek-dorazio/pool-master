/**
 * LeagueService — league creation, retrieval, and lifecycle management.
 */

import type { PrismaClient } from '@prisma/client';
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

export interface RootAdminLeagueView {
  league: League;
  role: LeagueRole;
}

const DEFAULT_JOIN_POLICY = JoinPolicy.COMMISSIONER_ONLY;

export class LeagueService {
  constructor(
    private readonly leagueRepo: LeagueRepository,
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
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

  async findAllForRootAdmin(): Promise<RootAdminLeagueView[]> {
    const leagues = await this.leagueRepo.findAll();
    return leagues.map((league) => ({
      league,
      role: LeagueRole.COMMISSIONER,
    }));
  }

  async inactivateLeague(leagueId: string): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      throw new LeagueOperationError(
        'League is already inactive',
        'LEAGUE_ALREADY_INACTIVE',
      );
    }

    return this.leagueRepo.update(leagueId, { isActive: false });
  }

  async updateLeagueDetails(leagueId: string, updates: UpdateLeagueDetailsInput): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
      );
    }

    return this.leagueRepo.update(leagueId, {
      name: updates.name,
      description: updates.description?.trim() ? updates.description.trim() : undefined,
    });
  }

  async updateLeagueIcon(leagueId: string, updates: UpdateLeagueIconInput): Promise<League> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive === false) {
      throw new LeagueOperationError(
        'Inactive leagues are read-only outside lifecycle actions',
        'LEAGUE_ICON_READ_ONLY_WHEN_INACTIVE',
      );
    }

    return this.leagueRepo.update(leagueId, {
      iconKey: updates.iconKey,
    });
  }

  async deleteInactiveLeague(leagueId: string, confirmationLeagueCode: string): Promise<void> {
    const league = await this.leagueRepo.findById(leagueId);
    if (!league) {
      throw new LeagueNotFoundError(leagueId);
    }

    if (league.isActive) {
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

  private async ensureDefaultSquad(leagueId: string, userId: string): Promise<void> {
    if (!this.squadRepo || !this.squadMembershipRepo || !this.prisma) {
      return;
    }

    await ensureDefaultSquadForLeagueMember({
      leagueId,
      userId,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
      prisma: this.prisma,
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

  constructor(reason: string, code = 'LEAGUE_OPERATION_INVALID') {
    super(reason);
    this.name = 'LeagueOperationError';
    this.code = code;
  }
}
