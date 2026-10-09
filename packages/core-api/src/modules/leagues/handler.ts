/**
 * League route handlers — league CRUD and lifecycle management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LeagueListResponse } from '@poolmaster/shared/dto';
import { toLeagueDto } from '../../mappers/leagues.mapper';
import { mapLeagueMembershipToDto } from '../../mappers/leagues-extra.mapper';
import { toSquadMembershipDto } from '../../mappers/squads.mapper';
import { sendError } from '../../core/error-handler';
import type { CreateLeagueInput, LeagueService } from './service';
import { LeagueNotFoundError, LeagueOperationError } from './service';
import { LeagueMembershipStatus } from '@poolmaster/shared/domain';
import type { League, LeagueMembership } from '@poolmaster/shared/domain';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  UserRepository,
} from '@poolmaster/shared/db';

export function createLeagueHandlers(
  leagueService: LeagueService,
  // Positional slot kept: routes.ts:100 passes it, and the other three repos are
  // read. Underscore rather than deletion so the factory's shape stays stable.
  _membershipRepo: LeagueMembershipRepository,
  squadMembershipRepo: SquadMembershipRepository,
  userRepo: UserRepository,
) {
  return {
    listLeagues,
    createLeague,
    getLeague,
    getLeagueByCode,
    updateLeagueDetails,
    updateLeagueIcon,
    inactivateLeague,
    activateLeague,
    deleteLeague,
  };

  /**
   * #202 step 3.4 — `getLeagueViewerShape()` is gone. It built
   * `{ memberType, leagueRelationship, isRootAdmin }` and spread it onto every league
   * payload this file produced, eight call sites' worth. Access rule A8: the viewer's
   * relationship travels once per league, on `getLeagueByCode`, as the membership edges
   * themselves — see `mapLeagueMembershipToDto` below and `LeagueContextResponse`.
   */
  async function listLeagues(
    request: FastifyRequest<{
      Querystring: {
        scope?: 'mine' | 'all';
        search?: string;
        isActive?: boolean;
      };
    }>,
    reply: FastifyReply,
  ): Promise<LeagueListResponse | FastifyReply> {
    const logger = request.contextLogger ?? request.log;
    const scope = request.query.scope ?? 'mine';
    logger.debug({
      action: 'leagueRoute.list.enter',
      data: {
        scope,
        userId: request.authUser?.userId ?? null,
        isRootAdmin: request.authUser?.isRootAdmin === true,
      },
    }, 'Handling list leagues request');
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueRoute.list.unauthenticated',
      }, 'Rejected list leagues request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    // A1 — the unscoped read is root admins only. This is the authorization that used to be
    // the `/api/v1/admin/leagues` route's existence; making scope a parameter means it has to
    // be stated, and it is stated here rather than in a preHandler because only one value of
    // the parameter needs it.
    if (scope === 'all' && request.authUser?.isRootAdmin !== true) {
      logger.warn({
        action: 'leagueRoute.list.scopeForbidden',
        data: { userId, scope },
      }, 'Rejected unscoped league list for non-root-admin');
      return sendError(
        reply,
        403,
        'LEAGUE_SCOPE_FORBIDDEN',
        'Listing every league requires root-admin access',
      );
    }

    const rows = await leagueService.listLeagues({
      scope,
      userId,
      filters: {
        ...(request.query.search ? { search: request.query.search } : {}),
        ...(request.query.isActive !== undefined ? { isActive: request.query.isActive } : {}),
      },
    });
    // The memberships below are all the VIEWER's, so the member embedded in each is the
    // viewer — one read, not one per league.
    const viewer = await userRepo.findById(userId);
    logger.info({
      action: 'leagueRoute.list.success',
      data: { scope, userId, leagueCount: rows.length },
    }, 'Listed leagues');
    // A8's one exception: the leagues list is inherently multi-league and the viewer's
    // relationship differs per league, so it travels as a SET beside the leagues rather than
    // as fields repeated on every row. Under `scope: 'all'` it is legitimately shorter than
    // the league list, and empty for a root admin who belongs to none of them.
    return {
      leagues: rows.map((row) => toLeagueDto(row.league, {
        memberCount: row.memberCount,
        activeContestCount: row.activeContestCount,
      })),
      memberships: viewer
        ? rows
          .map((row) => row.membership)
          .filter((membership): membership is LeagueMembership => Boolean(membership))
          .map((membership) => mapLeagueMembershipToDto(membership, viewer))
        : [],
    };
  }

  async function createLeague(
    request: FastifyRequest<{
      Body: {
        name: string;
        leagueCode: string;
        description?: string;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.create.enter',
      data: {
        userId: request.authUser?.userId ?? null,
        leagueCode: request.body.leagueCode,
        hasDescription: Boolean(request.body.description?.trim()),
      },
    }, 'Handling create league request');
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueRoute.create.unauthenticated',
      }, 'Rejected create league request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const body = request.body;
    const input: CreateLeagueInput = {
      createdBy: userId,
      name: body.name,
      leagueCode: body.leagueCode,
      description: body.description,
    };
    const result = await leagueService.createLeague(input);
    // #215 — the creator's COMMISSIONER membership is created with the league and the service
    // already returns it, so send the same `LeagueContextResponse` the two league reads send.
    // The client navigates straight into the new league and can now seed
    // `QueryKeys.leagues.detail(leagueCode)` from this response instead of fetching it again.
    // The alternative — the client assembling the membership itself — is the shadow projection
    // this epic exists to remove.
    const viewer = await userRepo.findById(userId);
    logger.info({
      action: 'leagueRoute.create.success',
      data: { leagueId: result.league.id, userId },
    }, 'Created league');
    return reply.status(201).send({
      league: toLeagueDto(result.league, { memberCount: 1, activeContestCount: 0 }),
      membership: viewer ? mapLeagueMembershipToDto(result.membership, viewer) : null,
      // Null by construction: a league has no squads the instant it is created.
      squadMembership: null,
    });
  }

  /**
   * Read a league by id.
   *
   * #202 — this returns `LeagueContextResponse`, the SAME shape as `getLeagueByCode`. It used
   * to return a bare `LeagueResponse`, so two reads of one object had two shapes — the shadow
   * projection this epic exists to remove, one level up from the DTOs.
   *
   * It matters beyond consistency: a contest-rooted page knows a `leagueId` and not a
   * `leagueCode`, so without the context here it had to scan every squad in the league to find
   * which one is the viewer's. That is the exact read A8 replaced.
   */
  async function getLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.get.enter',
      data: { leagueId: request.params.id, userId: request.authUser?.userId ?? null },
    }, 'Handling get league request');
    return sendLeagueContext(request, reply, {
      action: 'get',
      load: () => leagueService.getLeagueWithMembers(request.params.id),
      logData: { leagueId: request.params.id },
    });
  }

  async function getLeagueByCode(
    request: FastifyRequest<{ Params: { leagueCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.getByCode.enter',
      data: { leagueCode: request.params.leagueCode, userId: request.authUser?.userId ?? null },
    }, 'Handling get league by code request');
    return sendLeagueContext(request, reply, {
      action: 'getByCode',
      load: () => leagueService.getLeagueWithMembersByCode(request.params.leagueCode),
      logData: { leagueCode: request.params.leagueCode },
    });
  }

  /**
   * The league-context read, shared by both lookups (#202).
   *
   * One body, because the two routes differ only in how they find the league. They had a
   * copy each of the same membership authorization — the non-member 403 and the
   * inactive-membership 403 — which is two places for one rule to drift.
   *
   * `getLeague` is also gated by `requireMemberOfLeague` (#458), so for it the check below
   * never refuses; it stays here for `getLeagueByCode`, which has no league id for a hook to
   * read until the code is resolved.
   *
   * A8: this is the ONE response carrying the viewer's relationship to a league, and it
   * carries it as the canonical edges rather than as flags. The client fetches it once on
   * league selection and holds it, so every league-scoped response after it carries none.
   */
  async function sendLeagueContext(
    request: FastifyRequest,
    reply: FastifyReply,
    options: {
      action: 'get' | 'getByCode';
      load: () => Promise<{ league: League; members: LeagueMembership[] } | null>;
      logData: Record<string, unknown>;
    },
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    const { action, load, logData } = options;
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: `leagueRoute.${action}.unauthenticated`,
        data: logData,
      }, 'Rejected league request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }

    const result = await load();
    if (!result) {
      logger.warn({
        action: `leagueRoute.${action}.notFound`,
        data: logData,
      }, 'League not found');
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }

    const membership = result.members.find((member) => member.userId === userId);
    const rootAdminViewer = request.authUser?.isRootAdmin === true;
    if (!membership && !rootAdminViewer) {
      logger.warn({
        action: `leagueRoute.${action}.membershipMissing`,
        data: { ...logData, leagueId: result.league.id, userId },
      }, 'Rejected league request for non-member');
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to view it',
      );
    }
    if (membership && membership.status !== LeagueMembershipStatus.ACTIVE && !rootAdminViewer) {
      logger.warn({
        action: `leagueRoute.${action}.membershipInactive`,
        data: { ...logData, leagueId: result.league.id, userId, status: membership.status },
      }, 'Rejected league request for inactive membership');
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_INACTIVE',
        'Your membership in this league is inactive',
      );
    }

    const [squadMembership, viewer, counts] = await Promise.all([
      squadMembershipRepo.findByLeagueAndUser(result.league.id, userId),
      userRepo.findById(userId),
      leagueService.countLeagueActivity([result.league.id]),
    ]);

    logger.info({
      action: `leagueRoute.${action}.success`,
      data: { ...logData, leagueId: result.league.id, memberCount: result.members.length },
    }, 'Loaded league context');
    return reply.send({
      league: toLeagueDto(result.league, {
        memberCount: counts.memberCounts.get(result.league.id) ?? 0,
        activeContestCount: counts.activeContestCounts.get(result.league.id) ?? 0,
      }),
      // Both edges are the viewer's own, so the embedded member is the viewer.
      membership: membership && viewer ? mapLeagueMembershipToDto(membership, viewer) : null,
      squadMembership: squadMembership && viewer
        ? toSquadMembershipDto(squadMembership, viewer)
        : null,
    });
  }

  async function inactivateLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.inactivate.enter',
      data: { leagueId: request.params.id },
    }, 'Handling inactivate league request');
    try {
      const league = await leagueService.inactivateLeague(request.params.id);
      logger.info({
        action: 'leagueRoute.inactivate.success',
        data: { leagueId: request.params.id },
      }, 'Inactivated league');
      return reply.send({
        league: toLeagueDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.inactivate.notFound',
          data: { leagueId: request.params.id, errorName: err.name },
        }, 'Cannot inactivate missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.inactivate.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league inactivation');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function activateLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.activate.enter',
      data: { leagueId: request.params.id },
    }, 'Handling activate league request');
    try {
      const league = await leagueService.activateLeague(request.params.id);
      logger.info({
        action: 'leagueRoute.activate.success',
        data: { leagueId: request.params.id },
      }, 'Activated league');
      return reply.send({
        league: toLeagueDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.activate.notFound',
          data: { leagueId: request.params.id, errorName: err.name },
        }, 'Cannot activate missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.activate.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league activation');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function updateLeagueDetails(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { name: string; description?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.updateDetails.enter',
      data: { leagueId: request.params.id, hasDescription: request.body.description !== undefined },
    }, 'Handling update league details request');
    try {
      const league = await leagueService.updateLeagueDetails(request.params.id, request.body);
      logger.info({
        action: 'leagueRoute.updateDetails.success',
        data: { leagueId: request.params.id },
      }, 'Updated league details');
      return reply.send({
        league: toLeagueDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.updateDetails.notFound',
          data: { leagueId: request.params.id },
        }, 'Cannot update details for missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.updateDetails.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league detail update');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function updateLeagueIcon(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { iconKey: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.updateIcon.enter',
      data: { leagueId: request.params.id, iconKey: request.body.iconKey },
    }, 'Handling update league icon request');
    try {
      const league = await leagueService.updateLeagueIcon(request.params.id, {
        iconKey: request.body.iconKey as never,
      });
      logger.info({
        action: 'leagueRoute.updateIcon.success',
        data: { leagueId: request.params.id, iconKey: request.body.iconKey },
      }, 'Updated league icon');
      return reply.send({
        league: toLeagueDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.updateIcon.notFound',
          data: { leagueId: request.params.id },
        }, 'Cannot update icon for missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.updateIcon.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league icon update');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function deleteLeague(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { leagueCode: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.delete.enter',
      data: { leagueId: request.params.id, confirmationLeagueCode: request.body.leagueCode },
    }, 'Handling delete league request');
    try {
      await leagueService.deleteInactiveLeague(
        request.params.id,
        request.body.leagueCode,
      );
      logger.info({
        action: 'leagueRoute.delete.success',
        data: { leagueId: request.params.id },
      }, 'Deleted league');
      return reply.send({ success: true as const });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        logger.warn({
          action: 'leagueRoute.delete.notFound',
          data: { leagueId: request.params.id },
        }, 'Cannot delete missing league');
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        logger.warn({
          action: 'leagueRoute.delete.invalid',
          data: { leagueId: request.params.id, errorCode: err.code },
        }, 'Rejected league delete request');
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
