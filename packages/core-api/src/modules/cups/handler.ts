import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ListCupsQuery } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toCupDto, toCupProjectionDto, toCupSquadPointsDto } from '../../mappers/cups.mapper';
import {
  CupCrownedError,
  CupHasUnfinishedContestsError,
  CupNothingCountedError,
  CupNotFoundError,
  CupSquadNotFoundError,
  type CupService,
} from './service';

export function createCupHandlers(service: CupService) {
  return { listCups, listCupSeasons, getCup, getCupSquadPoints, getCupProjection, crownCup };

  async function listCups(
    request: FastifyRequest<{ Params: { id: string }; Querystring: ListCupsQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    const cups = await service.listSeasonCups(request.params.id, request.query.seasonYear);
    return reply.send({ cups: cups.map(toCupDto) });
  }

  async function listCupSeasons(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send({ seasonYears: await service.listSeasonYears(request.params.id) });
  }

  async function getCup(
    request: FastifyRequest<{ Params: { id: string; cupId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const cup = await service.getCup(request.params.id, request.params.cupId);
      return reply.send({ cup: toCupDto(cup) });
    } catch (error) {
      return sendCupError(reply, error);
    }
  }

  async function getCupSquadPoints(
    request: FastifyRequest<{ Params: { id: string; cupId: string; squadId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const points = await service.getSquadPoints(request.params.id, request.params.cupId, request.params.squadId);
      return reply.send({ squadPoints: toCupSquadPointsDto(points) });
    } catch (error) {
      return sendCupError(reply, error);
    }
  }

  async function getCupProjection(
    request: FastifyRequest<{ Params: { id: string; cupId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const projection = await service.getProjection(request.params.id, request.params.cupId);
      return reply.send({ projection: toCupProjectionDto(projection) });
    } catch (error) {
      return sendCupError(reply, error);
    }
  }

  async function crownCup(
    request: FastifyRequest<{ Params: { id: string; cupId: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const cup = await service.crown(request.params.id, request.params.cupId);
      return reply.send({ cup: toCupDto(cup) });
    } catch (error) {
      return sendCupError(reply, error);
    }
  }
}

async function sendCupError(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof CupNotFoundError || error instanceof CupSquadNotFoundError) {
    return sendError(reply, 404, error.code, error.message);
  }
  if (error instanceof CupCrownedError || error instanceof CupNothingCountedError) {
    return sendError(reply, 409, error.code, error.message);
  }
  if (error instanceof CupHasUnfinishedContestsError) {
    return sendError(reply, 409, error.code, error.message, {
      contests: error.contests.map((contest) => ({ contestId: contest.id, name: contest.name, status: contest.status })),
    });
  }
  throw error;
}
