/**
 * MemberService — role management and member lifecycle operations.
 */

import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type {
  CommissionerPermission,
  LeagueMembership,
  LeagueRole,
} from '@poolmaster/shared/domain';
import { LeagueMembershipStatus, LeagueRole as MembershipRole } from '@poolmaster/shared/domain';
import { ALL_COMMISSIONER_PERMISSIONS } from '../../core/permissions';

export interface ChangeRoleInput {
  leagueId: string;
  targetUserId: string;
  newRole: LeagueRole;
  permissions?: CommissionerPermission[];
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
      permissions:
        input.permissions
        ?? (input.newRole === MembershipRole.COMMISSIONER ? [...ALL_COMMISSIONER_PERMISSIONS] : []),
    };
    if (input.permissions !== undefined) {
      updates.permissions = input.permissions;
    }
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

  /** Updates the commissioner permission set for a membership. */
  async updatePermissions(
    membershipId: string,
    permissions: CommissionerPermission[],
  ): Promise<LeagueMembership> {
    return this.membershipRepo.update(membershipId, { permissions });
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

  constructor(reason: string, code = 'BAD_REQUEST') {
    super(reason);
    this.name = 'MemberOperationError';
    this.code = code;
  }
}
