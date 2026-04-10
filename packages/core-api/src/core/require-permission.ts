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
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const leagueId = (request.params as { id: string }).id;
    if (!leagueId) {
      return sendError(reply, 400, 'LEAGUE_ID_REQUIRED', 'League id is required');
    }
    const membership: LeagueMembership | null = await membershipRepo.findByLeagueAndUser(
      leagueId,
      userId,
    );
    if (!membership) {
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to perform this action',
      );
    }
    if (membership.status !== ('ACTIVE' satisfies LeagueMembershipStatus)) {
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_INACTIVE',
        'Your membership in this league is inactive',
      );
    }
    if (!hasPermission(membership, permission)) {
      return sendError(
        reply,
        403,
        'LEAGUE_PERMISSION_DENIED',
        'You do not have permission for this action',
      );
    }
  };
}
