/**
 * Admin role and permission model.
 *
 * Defines the five admin roles (SUPER_ADMIN through VIEWER) and the
 * permission matrix that maps each role to its allowed operations.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminRole = 'SUPER_ADMIN' | 'OPERATIONS' | 'SUPPORT' | 'DATA_OPS' | 'VIEWER';

export type AdminPermission =
  // Tenant operations
  | 'tenant.view'
  | 'tenant.edit'
  | 'tenant.suspend'
  | 'tenant.delete'
  | 'tenant.impersonate'
  // User operations
  | 'user.view'
  | 'user.edit'
  | 'user.reset_password'
  | 'user.force_logout'
  | 'user.merge'
  // Contest operations
  | 'contest.view'
  | 'contest.override'
  | 'contest.recalculate'
  | 'contest.close'
  // Sports data
  | 'sportsdata.view'
  | 'sportsdata.configure'
  | 'sportsdata.re_ingest'
  // Feature flags
  | 'flags.view'
  | 'flags.edit'
  // Platform
  | 'platform.health'
  | 'platform.announcements'
  | 'platform.migrations'
  // Audit
  | 'audit.view';

// ---------------------------------------------------------------------------
// Role → Permission matrix
// ---------------------------------------------------------------------------

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: [
    'tenant.view',
    'tenant.edit',
    'tenant.suspend',
    'tenant.delete',
    'tenant.impersonate',
    'user.view',
    'user.edit',
    'user.reset_password',
    'user.force_logout',
    'user.merge',
    'contest.view',
    'contest.override',
    'contest.recalculate',
    'contest.close',
    'sportsdata.view',
    'sportsdata.configure',
    'sportsdata.re_ingest',
    'flags.view',
    'flags.edit',
    'platform.health',
    'platform.announcements',
    'platform.migrations',
    'audit.view',
  ],
  OPERATIONS: [
    'tenant.view',
    'tenant.edit',
    'tenant.suspend',
    'user.view',
    'contest.view',
    'contest.override',
    'contest.recalculate',
    'sportsdata.view',
    'sportsdata.configure',
    'flags.view',
    'flags.edit',
    'platform.health',
    'platform.announcements',
    'audit.view',
  ],
  SUPPORT: [
    'tenant.view',
    'tenant.edit',
    'tenant.impersonate',
    'user.view',
    'user.edit',
    'user.reset_password',
    'user.force_logout',
    'user.merge',
    'contest.view',
    'flags.view',
    'audit.view',
  ],
  DATA_OPS: [
    'tenant.view',
    'contest.view',
    'contest.recalculate',
    'sportsdata.view',
    'sportsdata.configure',
    'sportsdata.re_ingest',
    'platform.health',
    'platform.migrations',
  ],
  VIEWER: [
    'tenant.view',
    'user.view',
    'contest.view',
    'sportsdata.view',
    'flags.view',
    'platform.health',
  ],
};

// ---------------------------------------------------------------------------
// Permission checking utilities
// ---------------------------------------------------------------------------

/**
 * Returns true if the given admin role grants the specified permission,
 * considering both the role's base permissions and any extra permissions.
 */
export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
  extraPermissions: AdminPermission[] = [],
): boolean {
  const rolePerms = ROLE_PERMISSIONS[role];
  if (!rolePerms) {
    return false;
  }
  return rolePerms.includes(permission) || extraPermissions.includes(permission);
}

/**
 * Fastify preHandler hook factory that checks whether the admin user on the
 * request has the required permission. Returns 401 if no admin context and
 * 403 if the permission is not granted.
 */
export function requireAdminPermission(
  permission: AdminPermission,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function checkAdminPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ctx = request.adminContext;
    if (!ctx) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHORIZED', message: 'Admin authentication required' });
    }
    if (!hasAdminPermission(ctx.adminUser.role, permission, ctx.adminUser.permissions)) {
      return reply
        .status(403)
        .send({ error: 'FORBIDDEN', message: `Missing admin permission: ${permission}` });
    }
  };
}
