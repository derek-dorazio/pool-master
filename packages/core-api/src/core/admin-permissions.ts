/**
 * Root-admin permission model.
 *
 * The active backend now uses a single unified global root-admin capability
 * on User rather than a separate AdminUser role matrix.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from './error-handler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminPermission =
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
  // Platform
  | 'platform.health'
  | 'platform.migrations'
  // Audit
  | 'audit.view';

/**
 * Fastify preHandler hook factory that checks whether the root-admin user on the
 * request has the required permission. Returns 401 if no admin context and
 * otherwise allows the request through for unified root-admin access.
 */
export function requireAdminPermission(
  _permission: AdminPermission,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function checkAdminPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ctx = request.rootAdminContext;
    if (!ctx) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Root-admin authentication required');
    }
  };
}
