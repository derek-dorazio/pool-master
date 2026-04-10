/**
 * League-scoped authorization helpers for member-only and commissioner-only routes.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import { isCommissioner } from '../../core/permissions';
import { sendError } from '../../core/error-handler';

function extractLeagueContext(request: FastifyRequest): { userId?: string; leagueId?: string } {
  const userId = request.authUser?.userId;
  const leagueId = (request.params as { id?: string }).id;
  return { userId, leagueId };
}

async function loadMembership(
  membershipRepo: LeagueMembershipRepository,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { userId, leagueId } = extractLeagueContext(request);
  if (!userId) {
    await sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    return null;
  }
  if (!leagueId) {
    await sendError(reply, 400, 'BAD_REQUEST', 'Missing league id');
    return null;
  }
  const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
  if (!membership) {
    await sendError(reply, 403, 'FORBIDDEN', 'You are not a member of this league');
    return null;
  }
  if (membership.status !== LeagueMembershipStatus.ACTIVE) {
    await sendError(reply, 403, 'FORBIDDEN', 'Your membership in this league is inactive');
    return null;
  }
  return membership;
}

/** Allows any league member to access the route. */
export function requireLeagueMembership(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkLeagueMembership(request, reply): Promise<void> {
    await loadMembership(membershipRepo, request, reply);
  };
}

/** Allows commissioners to access the route. */
export function requireCommissioner(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkCommissioner(request, reply): Promise<void> {
    const membership = await loadMembership(membershipRepo, request, reply);
    if (!membership) {
      return;
    }
    if (!isCommissioner(membership)) {
      return sendError(reply, 403, 'FORBIDDEN', 'You do not have permission for this action');
    }
  };
}
