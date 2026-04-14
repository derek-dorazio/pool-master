/**
 * League route handlers — league CRUD and lifecycle management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  toLeagueDetailDto,
  toLeagueSummaryDto,
} from '../../mappers/leagues.mapper';
import { sendError } from '../../core/error-handler';
import type { CreateLeagueInput, LeagueService } from './service';
import { LeagueNotFoundError, LeagueOperationError } from './service';

export function createLeagueHandlers(leagueService: LeagueService) {
  return {
    listLeagues,
    createLeague,
    getLeague,
    getLeagueByCode,
    inactivateLeague,
    deleteLeague,
  };

  async function listLeagues(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ leagues: unknown[] }> {
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'AUTH_SESSION_REQUIRED', 'Authenticated session required');
    }
    const leagues = await leagueService.findByUser(userId);
    return {
      leagues: leagues.map(({ league, membership }) => toLeagueSummaryDto(league, {
        role: membership.role,
      })),
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
    const userId = request.authUser?.userId;
    if (!userId) {
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
    return reply.status(201).send({
      league: toLeagueDetailDto(result.league, {
        memberCount: 1,
        activeContestCount: 0,
        role: result.membership.role,
      }),
    });
  }

  async function getLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId;
    const result = await leagueService.getLeagueWithMembers(request.params.id);
    if (!result) {
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }
    const membership = userId
      ? result.members.find((member) => member.userId === userId)
      : undefined;
    return reply.send({
      league: toLeagueDetailDto(result.league, {
        memberCount: result.members.length,
        activeContestCount: 0,
        role: membership?.role,
      }),
    });
  }

  async function getLeagueByCode(
    request: FastifyRequest<{ Params: { leagueCode: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId;
    const result = await leagueService.getLeagueWithMembersByCode(request.params.leagueCode);
    if (!result) {
      return sendError(reply, 404, 'LEAGUE_NOT_FOUND', 'League not found');
    }
    const membership = userId
      ? result.members.find((member) => member.userId === userId)
      : undefined;
    return reply.send({
      league: toLeagueDetailDto(result.league, {
        memberCount: result.members.length,
        activeContestCount: 0,
        role: membership?.role,
      }),
    });
  }

  async function inactivateLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const league = await leagueService.inactivateLeague(request.params.id);
      return reply.send({
        league: toLeagueDetailDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
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
    try {
      await leagueService.deleteInactiveLeague(request.params.id, request.body.leagueCode);
      return reply.send({ success: true as const });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }
      if (err instanceof LeagueOperationError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
