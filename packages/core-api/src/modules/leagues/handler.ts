/**
 * League route handlers — league CRUD and settings management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  toLeagueDetailDto,
  toLeagueListResponse,
} from '../../mappers/leagues.mapper';
import { sendError } from '../../core/error-handler';
import type { CreateLeagueInput, LeagueService } from './service';
import { LeagueNotFoundError } from './service';

export function createLeagueHandlers(leagueService: LeagueService) {
  return {
    listLeagues,
    createLeague,
    getLeague,
    updateSettings,
  };

  async function listLeagues(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ leagues: unknown[] }> {
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }
    const leagues = await leagueService.findByUser(userId);
    return toLeagueListResponse(leagues);
  }

  async function createLeague(
    request: FastifyRequest<{
      Body: {
        name: string;
        description?: string;
        visibility: string;
        maxMembers?: number;
        settings?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing user identity');
    }
    const body = request.body;
    const input: CreateLeagueInput = {
      createdBy: userId,
      name: body.name,
      description: body.description,
      visibility: body.visibility as CreateLeagueInput['visibility'],
      maxMembers: body.maxMembers,
      settings: body.settings as CreateLeagueInput['settings'],
    };
    const result = await leagueService.createLeague(input);
    return reply.status(201).send({
      league: toLeagueDetailDto(result.league, {
        memberCount: 1,
        activeContestCount: 0,
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
      return sendError(reply, 404, 'NOT_FOUND', 'League not found');
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

  async function updateSettings(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const league = await leagueService.updateSettings(
        request.params.id,
        request.body as Parameters<LeagueService['updateSettings']>[1],
      );
      return reply.send({
        league: toLeagueDetailDto(league),
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      throw err;
    }
  }
}
