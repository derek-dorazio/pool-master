/**
 * MemberService — role management and member lifecycle operations.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import type { LeagueMembership, LeagueRole as LeagueRoleType } from '@poolmaster/shared/domain';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import { inactivateLeagueMemberUnit } from './member-lifecycle';

export interface ChangeRoleInput {
  leagueId: string;
  targetUserId: string;
  newRole: LeagueRoleType;
}

export class MemberService {
  constructor(
    private readonly membershipRepo: LeagueMembershipRepository,
    private readonly prisma: PrismaClient,
    private readonly squadRepo?: SquadRepository,
    private readonly squadMembershipRepo?: SquadMembershipRepository,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /** Changes a member's role. */
  async changeRole(input: ChangeRoleInput): Promise<LeagueMembership> {
    this.logger?.debug({
      action: 'leagueMember.changeRole.enter',
      data: {
        leagueId: input.leagueId,
        targetUserId: input.targetUserId,
        newRole: input.newRole,
      },
    }, 'Changing league member role');
    const membership = await this.membershipRepo.findByLeagueAndUser(
      input.leagueId,
      input.targetUserId,
    );
    if (!membership) {
      this.logger?.warn({
        action: 'leagueMember.changeRole.notFound',
        data: {
          leagueId: input.leagueId,
          targetUserId: input.targetUserId,
        },
      }, 'Cannot change role for missing league member');
      throw new MemberNotFoundError(input.targetUserId, input.leagueId);
    }
    if (membership.status !== LeagueMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'leagueMember.changeRole.inactive',
        data: {
          leagueId: input.leagueId,
          targetUserId: input.targetUserId,
          status: membership.status,
        },
      }, 'Cannot change role for inactive league member');
      throw new MemberOperationError(
        'Cannot change the role of an inactive league member',
        'LEAGUE_MEMBER_INACTIVE',
      );
    }
    if (
      membership.role === LeagueRole.COMMISSIONER &&
      input.newRole !== LeagueRole.COMMISSIONER
    ) {
      await this.ensureAnotherActiveCommissioner(input.leagueId, membership.userId);
    }
    const updates: Partial<LeagueMembership> = {
      role: input.newRole,
    };
    const updatedMembership = await this.membershipRepo.update(membership.id, updates);
    this.logger?.info({
      action: 'leagueMember.changeRole.success',
      data: {
        leagueId: input.leagueId,
        targetUserId: input.targetUserId,
        newRole: input.newRole,
      },
    }, 'Changed league member role');
    return updatedMembership;
  }

  /** Removes a member from the league by inactivating the membership. */
  async removeMember(leagueId: string, userId: string): Promise<void> {
    this.logger?.debug({
      action: 'leagueMember.remove.enter',
      data: { leagueId, userId },
    }, 'Removing league member');
    const membership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership) {
      this.logger?.warn({
        action: 'leagueMember.remove.notFound',
        data: { leagueId, userId },
      }, 'Cannot remove missing league member');
      throw new MemberNotFoundError(userId, leagueId);
    }
    if (membership.status !== LeagueMembershipStatus.ACTIVE) {
      this.logger?.warn({
        action: 'leagueMember.remove.alreadyInactive',
        data: { leagueId, userId, status: membership.status },
      }, 'Cannot remove inactive league member');
      throw new MemberOperationError('Member is already inactive', 'LEAGUE_MEMBER_ALREADY_INACTIVE');
    }
    if (membership.role === LeagueRole.COMMISSIONER) {
      await this.ensureAnotherActiveCommissioner(leagueId, membership.userId);
    }
    await inactivateLeagueMemberUnit({
      leagueId,
      userId,
      membershipRepo: this.membershipRepo,
      prisma: this.prisma,
      squadRepo: this.squadRepo,
      squadMembershipRepo: this.squadMembershipRepo,
      logger: this.logger,
    });
    this.logger?.info({
      action: 'leagueMember.remove.success',
      data: { leagueId, userId },
    }, 'Removed league member');
  }

  private async ensureAnotherActiveCommissioner(
    leagueId: string,
    targetUserId: string,
  ): Promise<void> {
    const memberships = await this.membershipRepo.findByLeague(leagueId);
    const remainingActiveCommissioners = memberships.filter(
      (membership) =>
        membership.status === LeagueMembershipStatus.ACTIVE &&
        membership.role === LeagueRole.COMMISSIONER &&
        membership.userId !== targetUserId,
    );

    if (remainingActiveCommissioners.length === 0) {
      this.logger?.warn({
        action: 'leagueMember.ensureCommissioner.missingReplacement',
        data: { leagueId, targetUserId },
      }, 'Rejected operation because it would remove the last active commissioner');
      throw new MemberOperationError(
        'Appoint another active commissioner before removing or demoting the last commissioner.',
        'LEAGUE_LAST_COMMISSIONER_REQUIRED',
      );
    }
  }
}

export class MemberNotFoundError extends Error {
  constructor(userId: string, leagueId: string) {
    super(`Member ${userId} not found in league ${leagueId}`);
    this.name = 'MemberNotFoundError';
  }
}

export class MemberOperationError extends Error {
  code: string;

  constructor(reason: string, code = 'LEAGUE_MEMBER_OPERATION_INVALID') {
    super(reason);
    this.name = 'MemberOperationError';
    this.code = code;
  }
}
