import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ListCupsQuery } from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { toCupDto, toCupSquadPointsDto } from '../../mappers/cups.mapper';
import { CupNotFoundError, CupSquadNotFoundError, type CupService } from './service';

export function createCupHandlers(service: CupService) {
  return { listCups, getCup, getCupSquadPoints };

  async function listCups(
    request: FastifyRequest<{ Params: { id: string }; Querystring: ListCupsQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    const cups = await service.listSeasonCups(request.params.id, request.query.seasonYear);
    return reply.send({ cups: cups.map(toCupDto) });
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
}

async function sendCupError(reply: FastifyReply, error: unknown): Promise<void> {
  if (error instanceof CupNotFoundError || error instanceof CupSquadNotFoundError) {
    return sendError(reply, 404, error.code, error.message);
  }
  throw error;
}
