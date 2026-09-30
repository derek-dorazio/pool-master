/**
 * The Season operations reached by the season itself (#236); a sport league's season
 * list and creation live under /sport-leagues/{id}/seasons. Reads need a signed-in user;
 * writes need the root-admin claim (A10).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import '@poolmaster/shared/dto/sport-catalog.dto';
import type {
  CloneSeasonRequest,
  CloneSeasonResponse,
  SeasonResponse,
  SportLeagueResponse,
  UpdateSeasonRequest,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { sendError } from '../../core/error-handler';
import { mapSeasonToDto, mapSportLeagueToDto } from '../../mappers';
import { createSportEventServices } from '../events/wiring';

const TAGS = ['Seasons'];
const SEASON_PARAMS = {
  type: 'object',
  required: ['seasonId'],
  properties: { seasonId: { type: 'string', format: 'uuid' } },
};
type SeasonParams = { Params: { seasonId: string } };

function errors(...statuses: number[]) {
  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);
  return Object.fromEntries(statuses.map((status) => [status, envelope]));
}

export function seasonsModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);
  const { seasons, sportLeagues, sportEvents } = createSportEventServices(getAppPrisma(fastify), fastify.log);
  const write = { onRequest: requireRootAdmin };

  fastify.get('/:seasonId', {
    schema: {
      tags: TAGS,
      summary: 'Get a season',
      operationId: 'getSeason',
      params: SEASON_PARAMS,
      response: { 200: schemaRef('SeasonResponse'), ...errors(404) },
    },
    handler: async (request: FastifyRequest<SeasonParams>, reply: FastifyReply) => {
      const season = await seasons.getSeason(request.params.seasonId);
      if (!season) {
        return sendError(reply, 404, 'SEASON_NOT_FOUND', `Season ${request.params.seasonId} was not found.`);
      }
      return { season: mapSeasonToDto(season) } satisfies SeasonResponse;
    },
  });

  fastify.patch('/:seasonId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a season',
      description: 'Root admin only.',
      operationId: 'updateSeason',
      params: SEASON_PARAMS,
      body: schemaRef('UpdateSeasonRequest'),
      response: { 200: schemaRef('SeasonResponse'), ...errors(403, 404) },
    },
    handler: async (request: FastifyRequest<SeasonParams & { Body: UpdateSeasonRequest }>): Promise<SeasonResponse> => {
      const { startDate, endDate, ...rest } = request.body;
      const season = await seasons.updateSeason(request.params.seasonId, {
        ...rest,
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: new Date(endDate) }),
      });
      return { season: mapSeasonToDto(season) };
    },
  });

  fastify.post('/:seasonId/set-current', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Make a season its sport league\'s current season',
      description: 'One write on the sport league, so it never has zero or two current seasons. Returns the sport league. Root admin only.',
      operationId: 'setCurrentSeason',
      params: SEASON_PARAMS,
      response: { 200: schemaRef('SportLeagueResponse'), ...errors(403, 404) },
    },
    handler: async (request: FastifyRequest<SeasonParams>): Promise<SportLeagueResponse> => {
      const updated = await seasons.setCurrentSeason(request.params.seasonId);
      // Read back for its counts; setCurrentSeason has just updated this row, so it exists.
      const sportLeague = await sportLeagues.getSportLeague(updated.id);
      return { sportLeague: mapSportLeagueToDto(sportLeague as NonNullable<typeof sportLeague>) };
    },
  });

  fastify.post('/:seasonId/clone', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Clone a season\'s event calendar forward',
      description: 'Creates next year\'s season and re-creates each event in it as a fresh event (plans/124 §4.2a). Fields, tiers, prices, scores and provider links are never copied, and the current season does not change. Root admin only.',
      operationId: 'cloneSeason',
      params: SEASON_PARAMS,
      body: schemaRef('CloneSeasonRequest'),
      response: { 201: schemaRef('CloneSeasonResponse'), ...errors(403, 404, 409, 422) },
    },
    handler: async (request: FastifyRequest<SeasonParams & { Body: CloneSeasonRequest }>, reply: FastifyReply) => {
      const { season, clonedEventCount } = await seasons.cloneSeason(
        request.params.seasonId,
        request.body.targetYear,
        (input) => sportEvents.createEvent(input),
      );
      return reply.status(201).send({ season: mapSeasonToDto(season), clonedEventCount } satisfies CloneSeasonResponse);
    },
  });
}
