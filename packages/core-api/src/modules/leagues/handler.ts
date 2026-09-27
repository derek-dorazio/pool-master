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
import type { LeagueMembership } from '@poolmaster/shared/domain';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  UserRepository,
} from '@poolmaster/shared/db';

export function createLeagueHandlers(
  leagueService: LeagueService,
  membershipRepo: LeagueMembershipRepository,
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
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<LeagueListResponse | void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.list.enter',
      data: {
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
    const leagues = await leagueService.findByUser(userId);
    // The memberships below are all the VIEWER's, so the member embedded in each is the
    // viewer — one read, not one per league.
    const viewer = await userRepo.findById(userId);
    logger.info({
      action: 'leagueRoute.list.success',
      data: { userId, isRootAdmin: request.authUser?.isRootAdmin === true, leagueCount: leagues.length },
    }, 'Listed leagues');
    // A8's one exception: the leagues list is inherently multi-league and the viewer's
    // relationship differs per league, so it travels as a SET beside the leagues rather than
    // as fields repeated on every row.
    return {
      leagues: leagues.map((item) => toLeagueDto(item.league)),
      memberships: viewer
        ? leagues
          .map((item) => item.membership)
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
    logger.info({
      action: 'leagueRoute.create.success',
      data: { leagueId: result.league.id, userId },
    }, 'Created league');
    return reply.status(201).send({
      league: toLeagueDto(result.league, { memberCount: 1, activeContestCount: 0 }),
    });
  }

  async function getLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;
    logger.debug({
      action: 'leagueRoute.get.enter',
      data: { leagueId: request.params.id, userId: request.authUser?.userId ?? null },
    }, 'Handling get league request');
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueRoute.get.unauthenticated',
        data: { leagueId: request.params.id },
      }, 'Rejected league request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const result = await leagueService.getLeagueWithMembers(request.params.id);
    if (!result) {
      logger.warn({
        action: 'leagueRoute.get.notFound',
        data: { leagueId: request.params.id },
      }, 'League not found');
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }
    const membership = result.members.find((member) => member.userId === userId);
    const rootAdminViewer = request.authUser?.isRootAdmin === true;
    if (!membership && !rootAdminViewer) {
      logger.warn({
        action: 'leagueRoute.get.membershipMissing',
        data: { leagueId: request.params.id, userId },
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
        action: 'leagueRoute.get.membershipInactive',
        data: { leagueId: request.params.id, userId, status: membership.status },
      }, 'Rejected league request for inactive membership');
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_INACTIVE',
        'Your membership in this league is inactive',
      );
    }
    logger.info({
      action: 'leagueRoute.get.success',
      data: { leagueId: request.params.id, memberCount: result.members.length },
    }, 'Loaded league');
    return reply.send({
      league: toLeagueDto(result.league, {
        memberCount: result.members.length,
        activeContestCount: 0,
      }),
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
    const userId = request.authUser?.userId;
    if (!userId) {
      logger.warn({
        action: 'leagueRoute.getByCode.unauthenticated',
        data: { leagueCode: request.params.leagueCode },
      }, 'Rejected league-by-code request without authenticated session');
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const result = await leagueService.getLeagueWithMembersByCode(request.params.leagueCode);
    if (!result) {
      logger.warn({
        action: 'leagueRoute.getByCode.notFound',
        data: { leagueCode: request.params.leagueCode },
      }, 'League not found by code');
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }
    const membership = result.members.find((member) => member.userId === userId);
    const rootAdminViewer = request.authUser?.isRootAdmin === true;
    if (!membership && !rootAdminViewer) {
      logger.warn({
        action: 'leagueRoute.getByCode.membershipMissing',
        data: { leagueCode: request.params.leagueCode, leagueId: result.league.id, userId },
      }, 'Rejected league-by-code request for non-member');
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_REQUIRED',
        'You must be an active member of this league to view it',
      );
    }
    if (membership && membership.status !== LeagueMembershipStatus.ACTIVE && !rootAdminViewer) {
      logger.warn({
        action: 'leagueRoute.getByCode.membershipInactive',
        data: {
          leagueCode: request.params.leagueCode,
          leagueId: result.league.id,
          userId,
          status: membership.status,
        },
      }, 'Rejected league-by-code request for inactive membership');
      return sendError(
        reply,
        403,
        'LEAGUE_MEMBERSHIP_INACTIVE',
        'Your membership in this league is inactive',
      );
    }
    logger.info({
      action: 'leagueRoute.getByCode.success',
      data: { leagueId: result.league.id, leagueCode: result.league.leagueCode, memberCount: result.members.length },
    }, 'Loaded league by code');
    // A8 — this is the ONE response carrying the viewer's relationship to a league, and it
    // carries it as the canonical edges rather than as flags. The client fetches this once on
    // league selection and holds it for the session, so every league-scoped response after it
    // carries none.
    const [squadMembership, viewer] = await Promise.all([
      squadMembershipRepo.findByLeagueAndUser(result.league.id, userId),
      userRepo.findById(userId),
    ]);
    return reply.send({
      league: toLeagueDto(result.league, {
        memberCount: result.members.length,
        activeContestCount: 0,
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
      await leagueService.deleteInactiveLeague(request.params.id, request.body.leagueCode);
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
