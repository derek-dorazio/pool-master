/**
 * League-scoped authorization helpers for member-only and commissioner-only routes.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { LeagueMembershipRepository } from '@poolmaster/shared/db';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
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
  if (request.authUser?.isRootAdmin) {
    return {
      id: 'root-admin-commissioner-bypass',
      leagueId: leagueId ?? '',
      userId: userId ?? '',
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(0),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }
  if (!userId) {
    await sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return null;
  }
  if (!leagueId) {
    await sendError(reply, 400, 'LEAGUE_ID_REQUIRED', 'League id is required');
    return null;
  }
  const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
  if (!membership) {
    await sendError(
      reply,
      403,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
    return null;
  }
  if (membership.status !== LeagueMembershipStatus.ACTIVE) {
    await sendError(
      reply,
      403,
      'LEAGUE_MEMBERSHIP_INACTIVE',
      'Your membership in this league is inactive',
    );
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
    if (membership.role !== LeagueRole.COMMISSIONER) {
      return sendError(
        reply,
        403,
        'LEAGUE_PERMISSION_DENIED',
        'You do not have permission for this action',
      );
    }
  };
}
