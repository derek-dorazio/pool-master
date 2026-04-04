/**
 * League-scoped authorization helpers for member-only and commissioner-only routes.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import { isCommissionerOrOwner } from '../../core/permissions';

function extractLeagueContext(request: FastifyRequest): { userId?: string; leagueId?: string } {
  const userId = request.headers['x-user-id'] as string | undefined;
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
    await reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    return null;
  }
  if (!leagueId) {
    await reply.status(400).send({ error: 'BAD_REQUEST', message: 'Missing league id' });
    return null;
  }
  const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
  if (!membership) {
    await reply
      .status(403)
      .send({ error: 'FORBIDDEN', message: 'You are not a member of this league' });
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

/** Allows commissioners and owners to access the route. */
export function requireCommissionerOrOwner(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkCommissionerOrOwner(request, reply): Promise<void> {
    const membership = await loadMembership(membershipRepo, request, reply);
    if (!membership) {
      return;
    }
    if (!isCommissionerOrOwner(membership)) {
      return reply
        .status(403)
        .send({ error: 'FORBIDDEN', message: 'You do not have permission for this action' });
    }
  };
}
