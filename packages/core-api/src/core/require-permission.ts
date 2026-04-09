/**
 * Fastify preHandler hook factory for commissioner permission checks.
 *
 * Extracts the user and league from the request, looks up the membership,
 * and verifies the required permission before allowing the request to proceed.
 */

import type {
  CommissionerPermission,
  LeagueMembership,
  LeagueMembershipStatus,
} from '@poolmaster/shared/domain';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { hasPermission } from './permissions';
import { sendError } from './error-handler';

/**
 * Creates a preHandler hook that checks whether the requesting user has the
 * given commissioner permission for the league identified by `:id` in params.
 */
export function requirePermission(
  membershipRepo: LeagueMembershipRepository,
  permission: CommissionerPermission,
): preHandlerHookHandler {
  return async function checkPermission(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string | undefined;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }
    const leagueId = (request.params as { id: string }).id;
    if (!leagueId) {
      return sendError(reply, 400, 'BAD_REQUEST', 'Missing league id');
    }
    const membership: LeagueMembership | null = await membershipRepo.findByLeagueAndUser(
      leagueId,
      userId,
    );
    if (!membership) {
      return sendError(reply, 403, 'FORBIDDEN', 'You are not a member of this league');
    }
    if (membership.status !== ('ACTIVE' satisfies LeagueMembershipStatus)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Your membership in this league is inactive');
    }
    if (!hasPermission(membership, permission)) {
      return sendError(reply, 403, 'FORBIDDEN', 'You do not have permission for this action');
    }
  };
}

/**
 * Creates a preHandler hook that checks whether the requesting user is the
 * OWNER of the league identified by `:id` in params.
 */
export function requireOwner(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkOwner(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string | undefined;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }
    const leagueId = (request.params as { id: string }).id;
    const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
    if (!membership || membership.status !== ('ACTIVE' satisfies LeagueMembershipStatus) || membership.role !== 'OWNER') {
      return sendError(reply, 403, 'FORBIDDEN', 'Only the league owner can perform this action');
    }
  };
}
