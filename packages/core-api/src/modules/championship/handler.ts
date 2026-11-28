import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../core/error-handler';
import { toChampionshipCalendarResponse, toChampionshipDto, toChampionshipYearDto } from '../../mappers/championship.mapper';
import type { ChampionshipCalendarService } from './calendar-service';
import { ChampionshipLeagueNotFoundError, type ChampionshipService } from './service';

export function createChampionshipHandlers(service: ChampionshipService, calendar: ChampionshipCalendarService) {
  return { listChampionshipYears, getChampionship, getChampionshipCalendar };

  async function getChampionshipCalendar(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    return reply.send(toChampionshipCalendarResponse(await calendar.getCalendar(request.params.id)));
  }

  async function listChampionshipYears(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const years = await service.listYears(request.params.id);
    return reply.send({ years: years.map(toChampionshipYearDto) });
  }

  async function getChampionship(
    request: FastifyRequest<{ Params: { id: string; year: number } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const championship = await service.getYear(request.params.id, request.params.year);
      return reply.send({ championship: toChampionshipDto(championship) });
    } catch (error) {
      if (error instanceof ChampionshipLeagueNotFoundError) {
        return sendError(reply, 404, error.code, error.message);
      }
      throw error;
    }
  }
}
