/**
 * MemberService — role management and member lifecycle operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  MembershipTransaction,
} from '@poolmaster/shared/db';
import type { LeagueMembership, LeagueRole as LeagueRoleType } from '@poolmaster/shared/domain';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import {
  inactivateLeagueMemberUnit,
  LastCommissionerError,
  requireAnotherActiveCommissioner,
} from './member-lifecycle';
import { revokePendingOwnerInvitations } from '../squads/owner-membership';

export interface ChangeRoleInput {
  leagueId: string;
  targetUserId: string;
  newRole: LeagueRoleType;
}

export interface MemberServiceDeps {
  leagueMemberships: LeagueMembershipRepository;
  /** Removal writes the squad tables too, but only through this transaction's repositories. */
  membershipTransaction: MembershipTransaction;
  logger?: FastifyBaseLogger;
}

export class MemberService {
  private readonly membershipRepo: LeagueMembershipRepository;
  private readonly membershipTransaction: MembershipTransaction;
  private readonly logger?: FastifyBaseLogger;

  constructor(deps: MemberServiceDeps) {
    this.membershipRepo = deps.leagueMemberships;
    this.membershipTransaction = deps.membershipTransaction;
    this.logger = deps.logger;
  }

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
    await this.membershipTransaction.run(async (repos) => {
      const { inactivatedSquadId } = await inactivateLeagueMemberUnit({
        leagueId,
        userId,
        membershipRepo: repos.leagueMemberships,
        squadRepo: repos.squads,
        squadMembershipRepo: repos.squadMemberships,
        logger: this.logger,
      });
      if (inactivatedSquadId) {
        await revokePendingOwnerInvitations({
          leagueId,
          squadId: inactivatedSquadId,
          ownerInvitationRepo: repos.squadOwnerInvitations,
          logger: this.logger,
        });
      }
    });
    this.logger?.info({
      action: 'leagueMember.remove.success',
      data: { leagueId, userId },
    }, 'Removed league member');
  }

  /**
   * #218 — delegates to the shared rule in `member-lifecycle.ts`, translating its error into this
   * module's `MemberOperationError` so the route's error mapping is unchanged. Squad co-owner
   * removal can now also end a league membership, so the rule needed one home.
   */
  private async ensureAnotherActiveCommissioner(
    leagueId: string,
    targetUserId: string,
  ): Promise<void> {
    try {
      await requireAnotherActiveCommissioner({
        leagueId,
        targetUserId,
        membershipRepo: this.membershipRepo,
        logger: this.logger,
      });
    } catch (err) {
      if (err instanceof LastCommissionerError) {
        throw new MemberOperationError(err.message, err.code);
      }
      throw err;
    }
  }
}

export class MemberNotFoundError extends Error {
  readonly code = 'LEAGUE_MEMBER_NOT_FOUND';
  readonly statusCode = 404;

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
