import type { LeagueMembership } from '@poolmaster/shared/domain';

export function mapLeagueMembershipToDto(membership: LeagueMembership) {
  return {
    id: membership.id,
    leagueId: membership.leagueId,
    userId: membership.userId,
    role: membership.role,
    permissions: membership.permissions,
    joinedAt: membership.joinedAt.toISOString(),
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}
