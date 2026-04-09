/**
 * Commissioner permission checking utilities.
 *
 * OWNER role has implicit access to all permissions.
 * COMMISSIONER role has a configurable subset stored on the membership.
 * MEMBER has no commissioner permissions.
 */

import { CommissionerPermission, LeagueRole } from '@poolmaster/shared/domain';
import type { LeagueMembership } from '@poolmaster/shared/domain';

export const ALL_COMMISSIONER_PERMISSIONS: readonly CommissionerPermission[] = Object.values(
  CommissionerPermission,
) as CommissionerPermission[];

export const DEFAULT_COMMISSIONER_PERMISSIONS: readonly CommissionerPermission[] = [
  CommissionerPermission.LEAGUE_MEMBERS_INVITE,
  CommissionerPermission.ANNOUNCEMENT_POST,
  CommissionerPermission.CONTEST_CREATE,
  CommissionerPermission.CONTEST_EDIT,
  CommissionerPermission.DRAFT_START,
  CommissionerPermission.DRAFT_PAUSE,
] as const;

/** Returns true if the membership grants the given permission. OWNER always passes. */
export function hasPermission(
  membership: LeagueMembership,
  permission: CommissionerPermission,
): boolean {
  if (membership.role === LeagueRole.OWNER) {
    return true;
  }
  if (membership.role === LeagueRole.COMMISSIONER) {
    return membership.permissions.includes(permission);
  }
  return false;
}

/** Returns true if the membership grants any of the listed permissions. */
export function hasAnyPermission(
  membership: LeagueMembership,
  permissions: CommissionerPermission[],
): boolean {
  return permissions.some((p) => hasPermission(membership, p));
}

/** Returns true if the member is OWNER or COMMISSIONER. */
export function isCommissionerOrOwner(membership: LeagueMembership): boolean {
  return membership.role === LeagueRole.OWNER || membership.role === LeagueRole.COMMISSIONER;
}

/** Shorthand: can the member manage other members (invite, remove, change role)? */
export function canManageMembers(membership: LeagueMembership): boolean {
  return hasAnyPermission(membership, [
    CommissionerPermission.LEAGUE_MEMBERS_INVITE,
    CommissionerPermission.LEAGUE_MEMBERS_REMOVE,
    CommissionerPermission.LEAGUE_MEMBERS_ROLE_CHANGE,
  ]);
}
