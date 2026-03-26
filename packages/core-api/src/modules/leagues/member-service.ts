/**
 * MemberService — role management, member removal, and ownership transfer.
 */

import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type { CommissionerPermission, LeagueMembership, LeagueRole } from '@poolmaster/shared/domain';
import { LeagueRole as Roles } from '@poolmaster/shared/domain';

export interface ChangeRoleInput {
  leagueId: string;
  targetUserId: string;
  newRole: LeagueRole;
  permissions?: CommissionerPermission[];
}

export class MemberService {
  constructor(private readonly membershipRepo: LeagueMembershipRepository) {}

  /** Changes a member's role. Cannot change OWNER or promote to OWNER via this method. */
  async changeRole(input: ChangeRoleInput): Promise<LeagueMembership> {
    if (input.newRole === Roles.OWNER) {
      throw new MemberOperationError('Use transferOwnership to assign the OWNER role');
    }
    const membership = await this.membershipRepo.findByLeagueAndUser(
      input.leagueId,
      input.targetUserId,
    );
    if (!membership) {
      throw new MemberNotFoundError(input.targetUserId, input.leagueId);
    }
    if (membership.role === Roles.OWNER) {
      throw new MemberOperationError('Cannot change the role of the league owner');
    }
    const updates: Partial<LeagueMembership> = { role: input.newRole };
    if (input.permissions !== undefined) {
      updates.permissions = input.permissions;
    }
    return this.membershipRepo.update(membership.id, updates);
  }

  /** Removes a member from the league. Cannot remove the OWNER. */
  async removeMember(leagueId: string, userId: string): Promise<void> {
    const membership = await this.membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership) {
      throw new MemberNotFoundError(userId, leagueId);
    }
    if (membership.role === Roles.OWNER) {
      throw new MemberOperationError('Cannot remove the league owner');
    }
    await this.membershipRepo.delete(membership.id);
  }

  /** Transfers ownership from the current owner to another existing member. */
  async transferOwnership(
    leagueId: string,
    currentOwnerId: string,
    newOwnerId: string,
  ): Promise<{ previousOwner: LeagueMembership; newOwner: LeagueMembership }> {
    const currentOwner = await this.membershipRepo.findByLeagueAndUser(leagueId, currentOwnerId);
    if (!currentOwner || currentOwner.role !== Roles.OWNER) {
      throw new MemberOperationError('Only the current owner can transfer ownership');
    }
    const newOwner = await this.membershipRepo.findByLeagueAndUser(leagueId, newOwnerId);
    if (!newOwner) {
      throw new MemberNotFoundError(newOwnerId, leagueId);
    }
    const updatedPrevious = await this.membershipRepo.update(currentOwner.id, {
      role: Roles.COMMISSIONER,
    });
    const updatedNew = await this.membershipRepo.update(newOwner.id, {
      role: Roles.OWNER,
      permissions: [],
    });
    return { previousOwner: updatedPrevious, newOwner: updatedNew };
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
  constructor(reason: string) {
    super(reason);
    this.name = 'MemberOperationError';
  }
}
