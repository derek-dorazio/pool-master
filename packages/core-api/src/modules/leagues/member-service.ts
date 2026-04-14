/**
 * MemberService — role management and member lifecycle operations.
 */

import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type {
  LeagueMembership,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';

export interface ChangeRoleInput {
  leagueId: string;
  targetUserId: string;
  newRole: LeagueRole;
}

export class MemberService {
  constructor(private readonly membershipRepo: LeagueMembershipRepository) {}

  /** Changes a member's role. */
  async changeRole(input: ChangeRoleInput): Promise<LeagueMembership> {
    const membership = await this.membershipRepo.findByLeagueAndUser(
      input.leagueId,
      input.targetUserId,
    );
    if (!membership) {
      throw new MemberNotFoundError(input.targetUserId, input.leagueId);
    }
    if (membership.status !== LeagueMembershipStatus.ACTIVE) {
      throw new MemberOperationError(
        'Cannot change the role of an inactive league member',
        'LEAGUE_MEMBER_INACTIVE',
      );
    }
    const updates: Partial<LeagueMembership> = {
      role: input.newRole,
    };
    return this.membershipRepo.update(membership.id, updates);
  }

  /** Removes a member from the league by inactivating the membership. */
  async removeMember(leagueId: string, userId: string): Promise<void> {
    const membership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership) {
      throw new MemberNotFoundError(userId, leagueId);
    }
    if (membership.status !== LeagueMembershipStatus.ACTIVE) {
      throw new MemberOperationError('Member is already inactive', 'LEAGUE_MEMBER_ALREADY_INACTIVE');
    }
    await this.membershipRepo.update(membership.id, {
      status: LeagueMembershipStatus.INACTIVE,
    });
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
