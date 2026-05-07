/**
 * League-scoped authorization helpers for member-only and commissioner-only routes.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type {
  ContestRepository,
  LeagueMembershipRepository,
} from '@poolmaster/shared/db';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import { sendError } from '../../core/error-handler';

function extractLeagueContext(request: FastifyRequest): { userId?: string; leagueId?: string } {
  const userId = request.authUser?.userId;
  const leagueId = (request.params as { id?: string }).id;
  return { userId, leagueId };
}

function isRootAdmin(request: FastifyRequest) {
  return request.authUser?.isRootAdmin === true;
}

function validateLeagueScopeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = request.contextLogger ?? request.log;
  const { userId, leagueId } = extractLeagueContext(request);
  if (!userId) {
    logger.warn({
      action: 'leaguePermission.loadMembership.unauthenticated',
      data: { leagueId: leagueId ?? null },
    }, 'Rejected league permission check without authenticated session');
    void sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return null;
  }
  if (!leagueId) {
    logger.warn({
      action: 'leaguePermission.loadMembership.missingLeagueId',
      data: { userId },
    }, 'Rejected league permission check without league id');
    void sendError(reply, 400, 'LEAGUE_ID_REQUIRED', 'League id is required');
    return null;
  }
  return { userId, leagueId };
}

async function loadMembership(
  membershipRepo: LeagueMembershipRepository,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = request.contextLogger ?? request.log;
  const scope = validateLeagueScopeRequest(request, reply);
  if (!scope) {
    return null;
  }
  const { userId, leagueId } = scope;
  const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
  if (!membership) {
    logger.warn({
      action: 'leaguePermission.loadMembership.missingMembership',
      data: { leagueId, userId },
    }, 'Rejected league permission check for missing membership');
    await sendError(
      reply,
      403,
      'LEAGUE_MEMBERSHIP_REQUIRED',
      'You must be an active member of this league to perform this action',
    );
    return null;
  }
  if (membership.status !== LeagueMembershipStatus.ACTIVE) {
    logger.warn({
      action: 'leaguePermission.loadMembership.inactiveMembership',
      data: { leagueId, userId, status: membership.status },
    }, 'Rejected league permission check for inactive membership');
    await sendError(
      reply,
      403,
      'LEAGUE_MEMBERSHIP_INACTIVE',
      'Your membership in this league is inactive',
    );
    return null;
  }
  logger.debug({
    action: 'leaguePermission.loadMembership.success',
    data: { leagueId, userId, role: membership.role },
  }, 'Resolved active league membership');
  return membership;
}

/** Allows any league member to access the route. */
export function requireLeagueMembership(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkLeagueMembership(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leaguePermission.requireMembership.enter',
      data: { leagueId: (request.params as { id?: string }).id ?? null },
    }, 'Checking league membership permission');
    const scope = validateLeagueScopeRequest(request, reply);
    if (!scope) {
      return;
    }
    if (isRootAdmin(request)) {
      logger.debug({
        action: 'leaguePermission.requireMembership.rootAdminBypass',
        data: { leagueId: scope.leagueId, userId: scope.userId },
      }, 'Granted league membership permission via root-admin override');
      return;
    }
    await loadMembership(membershipRepo, request, reply);
  };
}

/** Allows commissioners to access the route. */
export function requireCommissioner(
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkCommissioner(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leaguePermission.requireCommissioner.enter',
      data: { leagueId: (request.params as { id?: string }).id ?? null },
    }, 'Checking commissioner permission');
    const scope = validateLeagueScopeRequest(request, reply);
    if (!scope) {
      return;
    }
    if (isRootAdmin(request)) {
      logger.debug({
        action: 'leaguePermission.requireCommissioner.rootAdminBypass',
        data: { leagueId: scope.leagueId, userId: scope.userId },
      }, 'Granted commissioner permission via root-admin override');
      return;
    }
    const membership = await loadMembership(membershipRepo, request, reply);
    if (!membership) {
      return;
    }
    if (membership.role !== LeagueRole.COMMISSIONER) {
      logger.warn({
        action: 'leaguePermission.requireCommissioner.denied',
        data: { leagueId: membership.leagueId, userId: membership.userId, role: membership.role },
      }, 'Rejected commissioner-only action');
      return sendError(
        reply,
        403,
        'LEAGUE_PERMISSION_DENIED',
        'You do not have permission for this action',
      );
    }
    logger.debug({
      action: 'leaguePermission.requireCommissioner.success',
      data: { leagueId: membership.leagueId, userId: membership.userId },
    }, 'Granted commissioner-only action');
  };
}

/**
 * Contest-scoped commissioner gate. Used by override-style endpoints whose
 * route paths use `:contestId` rather than `:id` (the league id), so the
 * standard `requireCommissioner` cannot resolve the league from params.
 *
 * Looks up the contest, resolves `leagueId` from it, and asserts the caller
 * is an active commissioner of that league (root-admins bypass). Returns 401
 * unauthenticated, 404 contest-not-found, 403 not-a-member or not-a-commissioner.
 */
export function requireCommissionerForContest(
  contestRepo: ContestRepository,
  membershipRepo: LeagueMembershipRepository,
): preHandlerHookHandler {
  return async function checkContestCommissioner(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const userId = request.authUser?.userId;
    const contestId = (request.params as { contestId?: string }).contestId;
    logger.debug({
      action: 'leaguePermission.requireCommissionerForContest.enter',
      data: { contestId: contestId ?? null },
    }, 'Checking contest-scoped commissioner permission');
    if (!userId) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.unauthenticated',
        data: { contestId: contestId ?? null },
      }, 'Rejected contest commissioner check without authenticated session');
      void sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
      return;
    }
    if (!contestId) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.missingContestId',
        data: { userId },
      }, 'Rejected contest commissioner check without contest id');
      void sendError(reply, 400, 'CONTEST_ID_REQUIRED', 'Contest id is required');
      return;
    }
    const contest = await contestRepo.findById(contestId);
    if (!contest) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.contestNotFound',
        data: { contestId, userId },
      }, 'Rejected contest commissioner check for missing contest');
      void sendError(reply, 404, 'CONTEST_NOT_FOUND', 'Contest not found');
      return;
    }
    if (request.authUser?.isRootAdmin === true) {
      logger.debug({
        action: 'leaguePermission.requireCommissionerForContest.rootAdminBypass',
        data: { contestId, leagueId: contest.leagueId, userId },
      }, 'Granted contest commissioner permission via root-admin override');
      return;
    }
    const membership = await membershipRepo.findByLeagueAndUser(
      contest.leagueId,
      userId,
    );
    if (!membership) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.missingMembership',
        data: { contestId, leagueId: contest.leagueId, userId },
      }, 'Rejected contest commissioner check for missing membership');
      void sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to perform this action',
      );
      return;
    }
    if (membership.status !== LeagueMembershipStatus.ACTIVE) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.inactiveMembership',
        data: { contestId, leagueId: contest.leagueId, userId, status: membership.status },
      }, 'Rejected contest commissioner check for inactive membership');
      void sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_INACTIVE',
        'Your membership in this league is inactive',
      );
      return;
    }
    if (membership.role !== LeagueRole.COMMISSIONER) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.denied',
        data: { contestId, leagueId: contest.leagueId, userId, role: membership.role },
      }, 'Rejected commissioner-only contest override');
      void sendError(
        reply,
        403,
        'LEAGUE_PERMISSION_DENIED',
        'You do not have permission for this action',
      );
      return;
    }
    logger.debug({
      action: 'leaguePermission.requireCommissionerForContest.success',
      data: { contestId, leagueId: contest.leagueId, userId },
    }, 'Granted commissioner-only contest override');
  };
}
