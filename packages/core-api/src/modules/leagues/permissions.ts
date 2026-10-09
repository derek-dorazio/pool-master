/**
 * League-scoped authorization gates: the `preHandler`s that decide who may reach a route inside a
 * league. The model is `rules/service-rules.md` §3 *Route Authorization*:
 *
 * - `requireMemberOfLeague(membershipRepo, leagueOf)` — read-only access within a league. The
 *   resolver says where the league comes from: `leagueFromPath` (`:id`),
 *   `existingLeagueFromPath(leagueRepo)` (`:id`, 404 for a missing league) or
 *   `leagueOfContest(contestRepo)` (`:contestId`). One rule, one name (#292).
 * - `requireCommissioner` / `requireCommissionerForContest` — league administration.
 * - `requireMemberOfSquad` — anything done on a squad's behalf (#292).
 * - `requireOwnSquad(…, leagueOf)` — acting for the caller's own squad in the resolved league,
 *   where the path names no squad (#458).
 *
 * Root admins bypass all of them (access rule A10). Membership is read per request, never from
 * the access token (access rule A12).
 *
 * Every rejection **awaits** `sendError`. An async hook that sends without awaiting resolves
 * before the response has finished (the etag `onSend` hook makes it finish later), `reply.sent`
 * is still false, and Fastify runs the handler as well: the caller gets the 403 and the write
 * lands anyway. That is how `requireCommissionerForContest` behaved until #193.
 */

import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type {
  ContestRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import { sendError } from '../../core/error-handler';

type Gate =
  | 'requireMemberOfLeague'
  | 'requireCommissioner'
  | 'requireCommissionerForContest'
  | 'requireMemberOfSquad'
  | 'requireOwnSquad';

function loggerOf(request: FastifyRequest) {
  return request.contextLogger ?? request.log;
}

function isRootAdmin(request: FastifyRequest) {
  return request.authUser?.isRootAdmin === true;
}

function paramOf(request: FastifyRequest, name: string): string | undefined {
  return (request.params as Record<string, string | undefined>)[name];
}

/**
 * Maps a request to the id of the league it acts in. Sends the rejection and returns `null` when
 * it cannot — a missing path parameter, or a resource that does not exist.
 */
export type LeagueResolver = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

/** The league named by the route's `:id`, for routes nested under `/leagues/:id`. */
export const leagueFromPath: LeagueResolver = async (request, reply) => {
  const leagueId = paramOf(request, 'id');
  if (!leagueId) {
    loggerOf(request).warn({
      action: 'leaguePermission.leagueFromPath.missingLeagueId',
      data: { userId: request.authUser?.userId ?? null },
    }, 'Rejected league permission check without league id');
    await sendError(reply, 400, 'LEAGUE_ID_REQUIRED', 'League id is required');
    return null;
  }
  return leagueId;
};

/**
 * The league named by the route's `:id`, refused with 404 `LEAGUE_NOT_FOUND` when no such league
 * exists — for a route that reads the league itself, so a deleted league answers 404 to everyone
 * rather than a membership 403 to all but root admins.
 */
export function existingLeagueFromPath(leagueRepo: LeagueRepository): LeagueResolver {
  return async (request, reply) => {
    const leagueId = await leagueFromPath(request, reply);
    if (!leagueId) {
      return null;
    }
    const league = await leagueRepo.findById(leagueId);
    if (!league) {
      loggerOf(request).warn({
        action: 'leaguePermission.existingLeagueFromPath.leagueNotFound',
        data: { leagueId, userId: request.authUser?.userId ?? null },
      }, 'Rejected league permission check for missing league');
      await sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
      return null;
    }
    return leagueId;
  };
}

/** The league that owns the contest named by the route's `:contestId`. */
export function leagueOfContest(contestRepo: ContestRepository): LeagueResolver {
  return async (request, reply) => {
    const logger = loggerOf(request);
    const contestId = paramOf(request, 'contestId');
    if (!contestId) {
      logger.warn({
        action: 'leaguePermission.leagueOfContest.missingContestId',
        data: { userId: request.authUser?.userId ?? null },
      }, 'Rejected contest-scoped permission check without contest id');
      await sendError(reply, 400, 'CONTEST_ID_REQUIRED', 'Contest id is required');
      return null;
    }
    const contest = await contestRepo.findById(contestId);
    if (!contest) {
      logger.warn({
        action: 'leaguePermission.leagueOfContest.contestNotFound',
        data: { contestId, userId: request.authUser?.userId ?? null },
      }, 'Rejected contest-scoped permission check for missing contest');
      await sendError(reply, 404, 'CONTEST_NOT_FOUND', 'Contest not found');
      return null;
    }
    return contest.leagueId;
  };
}

/** The signed-in caller's id, or a 401 sent and `null`. */
async function requireSession(gate: Gate, request: FastifyRequest, reply: FastifyReply) {
  const userId = request.authUser?.userId;
  if (!userId) {
    loggerOf(request).warn({
      action: `leaguePermission.${gate}.unauthenticated`,
      data: { params: request.params ?? null },
    }, 'Rejected league permission check without authenticated session');
    await sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    return null;
  }
  return userId;
}

/** The caller's ACTIVE membership of the league, or a 403 sent and `null`. */
async function loadActiveMembership(
  gate: Gate,
  membershipRepo: LeagueMembershipRepository,
  leagueId: string,
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = loggerOf(request);
  const membership = await membershipRepo.findByLeagueAndUser(leagueId, userId);
  if (!membership) {
    logger.warn({
      action: `leaguePermission.${gate}.missingMembership`,
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
      action: `leaguePermission.${gate}.inactiveMembership`,
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
  return membership;
}

/**
 * The steps every league gate starts with: a session (401), the league (the resolver's 400/404),
 * then the root-admin bypass. Returns `'root-admin'`, `null` when a rejection was sent, or the
 * caller's ACTIVE league membership (403 otherwise).
 */
async function resolveLeagueAccess(
  gate: Gate,
  membershipRepo: LeagueMembershipRepository,
  leagueOf: LeagueResolver,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const logger = loggerOf(request);
  logger.debug({
    action: `leaguePermission.${gate}.enter`,
    data: { params: request.params ?? null },
  }, 'Checking league permission');
  const userId = await requireSession(gate, request, reply);
  if (!userId) {
    return null;
  }
  const leagueId = await leagueOf(request, reply);
  if (!leagueId) {
    return null;
  }
  if (isRootAdmin(request)) {
    logger.debug({
      action: `leaguePermission.${gate}.rootAdminBypass`,
      data: { leagueId, userId },
    }, 'Granted league permission via root-admin override');
    return 'root-admin' as const;
  }
  return loadActiveMembership(gate, membershipRepo, leagueId, userId, request, reply);
}

async function rejectNonCommissioner(
  gate: Gate,
  membership: { leagueId: string; userId: string; role: LeagueRole },
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (membership.role === LeagueRole.COMMISSIONER) {
    loggerOf(request).debug({
      action: `leaguePermission.${gate}.success`,
      data: { leagueId: membership.leagueId, userId: membership.userId },
    }, 'Granted commissioner-only action');
    return false;
  }
  loggerOf(request).warn({
    action: `leaguePermission.${gate}.denied`,
    data: { leagueId: membership.leagueId, userId: membership.userId, role: membership.role },
  }, 'Rejected commissioner-only action');
  await sendError(reply, 403, 'LEAGUE_PERMISSION_DENIED', 'You do not have permission for this action');
  return true;
}

/**
 * League-member gate: the read-only half of the league access model. Browsing contests,
 * leaderboards, other squads and members requires being an active member, of any role, of the
 * league `leagueOf` resolves (root admins bypass). 401 unauthenticated, the resolver's 400/404,
 * 403 not-a-member or inactive.
 */
export function requireMemberOfLeague(
  membershipRepo: LeagueMembershipRepository,
  leagueOf: LeagueResolver,
): preHandlerAsyncHookHandler {
  return async function checkMemberOfLeague(request, reply): Promise<void> {
    const access = await resolveLeagueAccess('requireMemberOfLeague', membershipRepo, leagueOf, request, reply);
    if (access === null || access === 'root-admin') {
      return;
    }
    loggerOf(request).debug({
      action: 'leaguePermission.requireMemberOfLeague.success',
      data: { leagueId: access.leagueId, userId: access.userId, role: access.role },
    }, 'Granted league-member access');
  };
}

/** Commissioner gate for routes carrying the league id as `:id`. */
export function requireCommissioner(
  membershipRepo: LeagueMembershipRepository,
): preHandlerAsyncHookHandler {
  return async function checkCommissioner(request, reply): Promise<void> {
    const access = await resolveLeagueAccess('requireCommissioner', membershipRepo, leagueFromPath, request, reply);
    if (access === null || access === 'root-admin') {
      return;
    }
    await rejectNonCommissioner('requireCommissioner', access, request, reply);
  };
}

/**
 * Commissioner gate for routes reached by `:contestId`: resolves the contest's league, then
 * asserts the caller is an active commissioner there (root admins bypass). 401 unauthenticated,
 * 404 contest-not-found, 403 not-a-member or not-a-commissioner.
 */
export function requireCommissionerForContest(
  contestRepo: ContestRepository,
  membershipRepo: LeagueMembershipRepository,
): preHandlerAsyncHookHandler {
  const leagueOf = leagueOfContest(contestRepo);
  return async function checkContestCommissioner(request, reply): Promise<void> {
    const access = await resolveLeagueAccess('requireCommissionerForContest', membershipRepo, leagueOf, request, reply);
    if (access === null || access === 'root-admin') {
      return;
    }
    await rejectNonCommissioner('requireCommissionerForContest', access, request, reply);
  };
}

/**
 * Squad gate (#292): anything done on a squad's behalf — renaming it, adding or removing an
 * owner, inviting or replacing a co-owner. For routes under `/leagues/:id/squads/:squadId`.
 *
 * Admits an active owner of the squad (squad membership and ownership are the same thing), an
 * active commissioner of its league acting on a member's behalf (access rule A7), or a root admin
 * (A10). Both memberships must be ACTIVE: an inactive squad membership survives leaving a league.
 *
 * 401 unauthenticated, 400 missing ids, 404 a squad that is not in the path's league, 403
 * not-a-member, inactive, or not an owner of this squad.
 */
export function requireMemberOfSquad(
  squadRepo: SquadRepository,
  squadMembershipRepo: SquadMembershipRepository,
  membershipRepo: LeagueMembershipRepository,
): preHandlerAsyncHookHandler {
  const leagueOfSquad: LeagueResolver = async (request, reply) => {
    const leagueId = await leagueFromPath(request, reply);
    if (!leagueId) {
      return null;
    }
    const squadId = paramOf(request, 'squadId');
    if (!squadId) {
      await sendError(reply, 400, 'SQUAD_ID_REQUIRED', 'Squad id is required');
      return null;
    }
    const squad = await squadRepo.findById(squadId);
    if (!squad || squad.leagueId !== leagueId) {
      loggerOf(request).warn({
        action: 'leaguePermission.requireMemberOfSquad.squadNotFound',
        data: { leagueId, squadId, userId: request.authUser?.userId ?? null },
      }, 'Rejected squad permission check for a squad outside the league');
      await sendError(reply, 404, 'SQUAD_NOT_FOUND', `Squad not found: ${squadId}`);
      return null;
    }
    return leagueId;
  };

  return async function checkMemberOfSquad(request, reply): Promise<void> {
    const logger = loggerOf(request);
    const access = await resolveLeagueAccess('requireMemberOfSquad', membershipRepo, leagueOfSquad, request, reply);
    if (access === null || access === 'root-admin') {
      return;
    }
    const squadId = paramOf(request, 'squadId') as string;
    if (access.role === LeagueRole.COMMISSIONER) {
      logger.debug({
        action: 'leaguePermission.requireMemberOfSquad.commissionerBypass',
        data: { leagueId: access.leagueId, squadId, userId: access.userId },
      }, 'Granted squad action to the league commissioner');
      return;
    }
    const squadMembership = await squadMembershipRepo.findBySquadAndUser(squadId, access.userId);
    if (!squadMembership || squadMembership.status !== SquadMembershipStatus.ACTIVE) {
      logger.warn({
        action: 'leaguePermission.requireMemberOfSquad.denied',
        data: {
          leagueId: access.leagueId,
          squadId,
          userId: access.userId,
          reason: squadMembership ? `status:${squadMembership.status}` : 'membership_missing',
        },
      }, 'Rejected squad action for a caller who does not own the squad');
      await sendError(
        reply,
        403,
        'SQUAD_OWNER_REQUIRED',
        'You must be an active team owner to perform this action',
      );
      return;
    }
    logger.debug({
      action: 'leaguePermission.requireMemberOfSquad.success',
      data: { leagueId: access.leagueId, squadId, userId: access.userId },
    }, 'Granted squad action to an active owner');
  };
}

/**
 * Own-squad gate (#458): acting for the caller's own squad in the league `leagueOf` resolves, on
 * routes whose path names no squad — entering or leaving a contest as `/contests/:contestId/
 * entries/me`. The squad is the caller's squad membership in that league, so there is no
 * commissioner bypass: a commissioner acts here for their own team like anyone else.
 *
 * Root admins bypass (A10); what they may then do is the service's call. 401 unauthenticated, the
 * resolver's 400/404, 403 not-a-member or inactive (`LEAGUE_MEMBERSHIP_*`), 403
 * `SQUAD_MEMBERSHIP_REQUIRED` for a caller with no team in the league, 403
 * `SQUAD_MEMBERSHIP_INACTIVE` for one whose team membership has ended.
 */
export function requireOwnSquad(
  membershipRepo: LeagueMembershipRepository,
  squadMembershipRepo: SquadMembershipRepository,
  leagueOf: LeagueResolver,
): preHandlerAsyncHookHandler {
  return async function checkOwnSquad(request, reply): Promise<void> {
    const logger = loggerOf(request);
    const access = await resolveLeagueAccess('requireOwnSquad', membershipRepo, leagueOf, request, reply);
    if (access === null || access === 'root-admin') {
      return;
    }
    const squadMembership = await squadMembershipRepo.findByLeagueAndUser(access.leagueId, access.userId);
    if (!squadMembership) {
      logger.warn({
        action: 'leaguePermission.requireOwnSquad.missingSquadMembership',
        data: { leagueId: access.leagueId, userId: access.userId },
      }, 'Rejected own-squad action for a caller with no team in the league');
      await sendError(
        reply,
        403,
        'SQUAD_MEMBERSHIP_REQUIRED',
        'You must have an active team in this league to perform this action',
      );
      return;
    }
    if (squadMembership.status !== SquadMembershipStatus.ACTIVE) {
      logger.warn({
        action: 'leaguePermission.requireOwnSquad.inactiveSquadMembership',
        data: {
          leagueId: access.leagueId,
          squadId: squadMembership.squadId,
          userId: access.userId,
          status: squadMembership.status,
        },
      }, 'Rejected own-squad action for a caller whose team membership has ended');
      await sendError(reply, 403, 'SQUAD_MEMBERSHIP_INACTIVE', 'Your membership of this team has ended');
      return;
    }
    logger.debug({
      action: 'leaguePermission.requireOwnSquad.success',
      data: { leagueId: access.leagueId, squadId: squadMembership.squadId, userId: access.userId },
    }, 'Granted own-squad action to an active owner');
  };
}
