/**
 * The SportLeague operation set and its child, the Participant↔SportLeague
 * affiliations (#236). A sport league's events are reached through the event list,
 * filtered by sport league and event year (plans/147). Before #236 the same operations were reachable
 * only as `adminGetGolfLeagueRoster` and siblings, golf-named doors onto cross-sport
 * services. Reads need a signed-in user; writes need the root-admin claim (A10).
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import '@poolmaster/shared/dto/sport-catalog.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { createSportEventServices } from '../events/wiring';
import { createSportLeagueHandlers } from './handler';

const TAGS = ['Sport leagues'];

function errors(...statuses: number[]) {
  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);
  return Object.fromEntries(statuses.map((status) => [status, envelope]));
}

const SPORT_LEAGUE_PARAMS = {
  type: 'object',
  required: ['sportLeagueId'],
  properties: { sportLeagueId: { type: 'string', format: 'uuid' } },
};

export function sportLeaguesModule(fastify: FastifyInstance): void {
  void fastify.register(schemaComponentsPlugin);
  const services = createSportEventServices(getAppPrisma(fastify), fastify.log);
  const handler = createSportLeagueHandlers(services.sportLeagues);
  const write = { onRequest: requireRootAdmin };

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List sport leagues',
      description: 'Every sport league, or one sport\'s, each with its affiliation and event counts. The one list that takes a sport: a sport league is where the sport is chosen.',
      operationId: 'listSportLeagues',
      querystring: schemaRef('SportLeagueListQuery'),
      response: { 200: schemaRef('SportLeagueListResponse'), ...errors(404) },
    },
    handler: handler.listSportLeagues,
  });

  fastify.get('/:sportLeagueId', {
    schema: {
      tags: TAGS,
      summary: 'Get a sport league',
      operationId: 'getSportLeague',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueResponse'), ...errors(404) },
    },
    handler: handler.getSportLeague,
  });

  fastify.post('/', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Create a sport league',
      description: 'Adding a tour is one call, not a migration. Root admin only.',
      operationId: 'createSportLeague',
      body: schemaRef('CreateSportLeagueRequest'),
      response: { 201: schemaRef('SportLeagueResponse'), ...errors(403, 404, 409) },
    },
    handler: handler.createSportLeague,
  });

  fastify.patch('/:sportLeagueId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport league',
      description: 'Setting currentEventYear is "set as current": one write, so the sport league never has two current years, '
        + 'and 422 EVENT_YEAR_HAS_NO_EVENTS for a year the sport league has no events in (plans/147 decision 6). Root admin only.',
      operationId: 'updateSportLeague',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('UpdateSportLeagueRequest'),
      response: { 200: schemaRef('SportLeagueResponse'), ...errors(403, 404, 422) },
    },
    handler: handler.updateSportLeague,
  });

  fastify.get('/:sportLeagueId/affiliations', {
    schema: {
      tags: TAGS,
      summary: 'List a sport league\'s affiliations',
      description: 'Who competes in the sport league and their current rank, each with the canonical participant.',
      operationId: 'listParticipantLeagueAffiliations',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('ParticipantLeagueAffiliationListResponse'), ...errors(404) },
    },
    handler: handler.listAffiliations,
  });

  fastify.post('/:sportLeagueId/affiliations', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Affiliate a participant with a sport league',
      description: 'Root admin only. 409 when the participant is already affiliated.',
      operationId: 'createParticipantLeagueAffiliation',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('CreateParticipantLeagueAffiliationRequest'),
      response: { 201: schemaRef('ParticipantLeagueAffiliationResponse'), ...errors(403, 404, 409) },
    },
    handler: handler.createAffiliation,
  });

  fastify.patch('/:sportLeagueId/affiliations', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Re-rank a sport league\'s affiliations',
      description: 'Root admin only. All or none.',
      operationId: 'updateParticipantLeagueAffiliationRankings',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('UpdateParticipantLeagueAffiliationRankingsRequest'),
      response: { 200: schemaRef('ParticipantLeagueAffiliationListResponse'), ...errors(403, 404) },
    },
    handler: handler.updateAffiliationRankings,
  });

  fastify.delete('/:sportLeagueId/affiliations/:participantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Remove a participant\'s affiliation',
      description: 'Root admin only.',
      operationId: 'deleteParticipantLeagueAffiliation',
      params: {
        type: 'object',
        required: ['sportLeagueId', 'participantId'],
        properties: { sportLeagueId: { type: 'string', format: 'uuid' }, participantId: { type: 'string', format: 'uuid' } },
      },
      response: { 204: { type: 'null' }, ...errors(403, 404) },
    },
    handler: handler.deleteAffiliation,
  });

  fastify.post('/:sportLeagueId/affiliations/upload/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview an affiliation upload',
      description: 'Resolves each row to a participant of the sport league\'s sport and writes nothing. Root admin only.',
      operationId: 'previewParticipantLeagueAffiliationUpload',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('ParticipantLeagueAffiliationUploadRequest'),
      response: { 200: schemaRef('ParticipantLeagueAffiliationUploadPreviewResponse'), ...errors(403, 404) },
    },
    handler: handler.previewAffiliationUpload,
  });

  fastify.post('/:sportLeagueId/affiliations/upload', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply an affiliation upload',
      description: 'Affiliates and ranks every row, all or none; 422 when any row does not resolve. Root admin only.',
      operationId: 'applyParticipantLeagueAffiliationUpload',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('ParticipantLeagueAffiliationUploadRequest'),
      response: { 200: schemaRef('ParticipantLeagueAffiliationListResponse'), ...errors(403, 404, 422) },
    },
    handler: handler.applyAffiliationUpload,
  });
}
