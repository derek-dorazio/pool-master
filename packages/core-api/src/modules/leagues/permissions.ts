/**
 * League-scoped authorization helpers for member-only and commissioner-only routes.
 */

import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
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

async function validateLeagueScopeRequest(
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
    await sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return null;
  }
  if (!leagueId) {
    logger.warn({
      action: 'leaguePermission.loadMembership.missingLeagueId',
      data: { userId },
    }, 'Rejected league permission check without league id');
    await sendError(reply, 400, 'LEAGUE_ID_REQUIRED', 'League id is required');
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
  const scope = await validateLeagueScopeRequest(request, reply);
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
): preHandlerAsyncHookHandler {
  return async function checkLeagueMembership(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leaguePermission.requireMembership.enter',
      data: { leagueId: (request.params as { id?: string }).id ?? null },
    }, 'Checking league membership permission');
    const scope = await validateLeagueScopeRequest(request, reply);
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
): preHandlerAsyncHookHandler {
  return async function checkCommissioner(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leaguePermission.requireCommissioner.enter',
      data: { leagueId: (request.params as { id?: string }).id ?? null },
    }, 'Checking commissioner permission');
    const scope = await validateLeagueScopeRequest(request, reply);
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

type ContestScopedGate = 'requireCommissionerForContest' | 'requireMemberOfLeague';

function contestIdOf(request: FastifyRequest): string | undefined {
  return (request.params as { contestId?: string }).contestId;
}

/**
 * The work both contest-scoped gates share: resolve the contest named by `:contestId`, walk to
 * the league that owns it, and load the caller's active membership there. Sends the rejection
 * and returns `null` when the request cannot proceed; returns `'root-admin'` for a root admin,
 * who bypasses league membership (access rule A10); otherwise returns the active membership.
 *
 * Membership is read per request, never from the access token (access rule A12).
 *
 * Every rejection here and in the gates **awaits** `sendError`. An async hook that sends without
 * awaiting resolves before the response has finished (the etag `onSend` hook makes it finish
 * later), `reply.sent` is still false, and Fastify runs the handler as well: the caller gets the
 * 403 and the write lands anyway. That is how `requireCommissionerForContest` behaved until #193.
 */
async function loadActiveMembershipForContest(
  gate: ContestScopedGate,
  contestRepo: ContestRepository,
  membershipRepo: LeagueMembershipRepository,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = request.contextLogger ?? request.log;
  const userId = request.authUser?.userId;
  const contestId = contestIdOf(request);
  logger.debug({
    action: `leaguePermission.${gate}.enter`,
    data: { contestId: contestId ?? null },
  }, 'Checking contest-scoped league permission');
  if (!userId) {
    logger.warn({
      action: `leaguePermission.${gate}.unauthenticated`,
      data: { contestId: contestId ?? null },
    }, 'Rejected contest-scoped permission check without authenticated session');
    await sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return null;
  }
  if (!contestId) {
    logger.warn({
      action: `leaguePermission.${gate}.missingContestId`,
      data: { userId },
    }, 'Rejected contest-scoped permission check without contest id');
    await sendError(reply, 400, 'CONTEST_ID_REQUIRED', 'Contest id is required');
    return null;
  }
  const contest = await contestRepo.findById(contestId);
  if (!contest) {
    logger.warn({
      action: `leaguePermission.${gate}.contestNotFound`,
      data: { contestId, userId },
    }, 'Rejected contest-scoped permission check for missing contest');
    await sendError(reply, 404, 'CONTEST_NOT_FOUND', 'Contest not found');
    return null;
  }
  if (request.authUser?.isRootAdmin === true) {
    logger.debug({
      action: `leaguePermission.${gate}.rootAdminBypass`,
      data: { contestId, leagueId: contest.leagueId, userId },
    }, 'Granted contest-scoped permission via root-admin override');
    return 'root-admin' as const;
  }
  const membership = await membershipRepo.findByLeagueAndUser(contest.leagueId, userId);
  if (!membership) {
    logger.warn({
      action: `leaguePermission.${gate}.missingMembership`,
      data: { contestId, leagueId: contest.leagueId, userId },
    }, 'Rejected contest-scoped permission check for missing membership');
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
      action: `leaguePermission.${gate}.inactiveMembership`,
      data: { contestId, leagueId: contest.leagueId, userId, status: membership.status },
    }, 'Rejected contest-scoped permission check for inactive membership');
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
): preHandlerAsyncHookHandler {
  return async function checkContestCommissioner(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const membership = await loadActiveMembershipForContest(
      'requireCommissionerForContest',
      contestRepo,
      membershipRepo,
      request,
      reply,
    );
    if (membership === null || membership === 'root-admin') {
      return;
    }
    if (membership.role !== LeagueRole.COMMISSIONER) {
      logger.warn({
        action: 'leaguePermission.requireCommissionerForContest.denied',
        data: { contestId: contestIdOf(request), leagueId: membership.leagueId, userId: membership.userId, role: membership.role },
      }, 'Rejected commissioner-only contest action');
      await sendError(
        reply,
        403,
        'LEAGUE_PERMISSION_DENIED',
        'You do not have permission for this action',
      );
      return;
    }
    logger.debug({
      action: 'leaguePermission.requireCommissionerForContest.success',
      data: { contestId: contestIdOf(request), leagueId: membership.leagueId, userId: membership.userId },
    }, 'Granted commissioner-only contest action');
  };
}

/**
 * League-member gate for a resource reached by id (#193). The read-only half of the league
 * access model: browsing contests, leaderboards, other squads and members within a league
 * requires being an active member of the league that owns the resource, and nothing more.
 *
 * The contest-scoped form: resolves the contest named by `:contestId`, walks to its league, and
 * asserts the caller is an active member of any role there (root-admins bypass). Returns 401
 * unauthenticated, 404 contest-not-found, 403 not-a-member or inactive. `requireLeagueMembership`
 * is the same rule for routes that carry the league id in the path as `:id`.
 */
export function requireMemberOfLeague(
  contestRepo: ContestRepository,
  membershipRepo: LeagueMembershipRepository,
): preHandlerAsyncHookHandler {
  return async function checkMemberOfLeague(request, reply): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const membership = await loadActiveMembershipForContest(
      'requireMemberOfLeague',
      contestRepo,
      membershipRepo,
      request,
      reply,
    );
    if (membership === null || membership === 'root-admin') {
      return;
    }
    logger.debug({
      action: 'leaguePermission.requireMemberOfLeague.success',
      data: { contestId: contestIdOf(request), leagueId: membership.leagueId, userId: membership.userId, role: membership.role },
    }, 'Granted league-member contest access');
  };
}
