import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import {
  eventRecordSchema,
  eventResponseSchema,
  eventSummarySchema,
  feedKinds,
  mockFeedProviderId,
  scenarioRecordSchema,
  scenarioSummarySchema,
  snapshotResponseSchema,
  updatesResponseSchema,
} from './contracts';
import { ScenarioStore } from './scenario-store';

function buildScenarioStore(fastify: FastifyInstance): ScenarioStore {
  const scenarioDir = process.env.SCENARIO_DIR ?? resolve(__dirname, '../contest-feed-scenarios');
  return new ScenarioStore(scenarioDir, fastify.log);
}

export async function mockContestFeedRoutes(fastify: FastifyInstance): Promise<void> {
  const store = buildScenarioStore(fastify);

  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Check service health',
        operationId: 'mockContestFeedHealth',
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'service', 'scenarioCount', 'eventCount', 'feedKinds'],
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              scenarioCount: { type: 'number' },
              eventCount: { type: 'number' },
              feedKinds: { type: 'array', items: { type: 'string', enum: feedKinds } },
            },
          },
        },
      },
    },
    async () => {
      const payload = {
        status: 'ok',
        service: mockFeedProviderId,
        scenarioCount: store.getScenarioCount(),
        eventCount: store.getEventCount(),
        feedKinds,
      };
      fastify.log.info(
        { action: 'mockFeedRoute.health', data: { scenarioCount: payload.scenarioCount, eventCount: payload.eventCount } },
        'Served mock contest-feed health response',
      );
      return payload;
    },
  );

  fastify.get(
    '/v1/scenarios',
    {
      schema: {
        tags: ['Scenarios'],
        summary: 'List contest feed scenarios',
        operationId: 'listMockContestFeedScenarios',
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['scenarios'],
            properties: {
              scenarios: { type: 'array', items: scenarioSummarySchema },
            },
          },
        },
      },
    },
    async () => {
      const scenarios = store.listScenarios();
      fastify.log.info(
        { action: 'mockFeedRoute.listScenarios', data: { scenarioCount: scenarios.length } },
        'Served mock contest-feed scenario list',
      );
      return { scenarios };
    },
  );

  fastify.get<{ Params: { scenarioId: string } }>(
    '/v1/scenarios/:scenarioId',
    {
      schema: {
        tags: ['Scenarios'],
        summary: 'Get a contest feed scenario',
        operationId: 'getMockContestFeedScenario',
        params: {
          type: 'object',
          required: ['scenarioId'],
          properties: {
            scenarioId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['scenario'],
            properties: {
              scenario: scenarioRecordSchema,
            },
          },
        },
      },
    },
    async (request) => {
      fastify.log.debug(
        { action: 'mockFeedRoute.getScenario.start', data: request.params },
        'Serving mock contest-feed scenario detail',
      );
      return {
        scenario: store.getScenario(request.params.scenarioId),
      };
    },
  );

  fastify.get<{ Params: { scenarioId: string } }>(
    '/v1/scenarios/:scenarioId/events',
    {
      schema: {
        tags: ['Scenarios'],
        summary: 'List events for a scenario',
        operationId: 'listMockContestFeedScenarioEvents',
        params: {
          type: 'object',
          required: ['scenarioId'],
          properties: {
            scenarioId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['scenarioId', 'events'],
            properties: {
              scenarioId: { type: 'string' },
              events: { type: 'array', items: eventSummarySchema },
            },
          },
        },
      },
    },
    async (request) => {
      const events = store.listEvents(request.params.scenarioId);
      fastify.log.info(
        { action: 'mockFeedRoute.listEvents', data: { scenarioId: request.params.scenarioId, eventCount: events.length } },
        'Served mock contest-feed event list',
      );
      return {
        scenarioId: request.params.scenarioId,
        events,
      };
    },
  );

  fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
    '/v1/scenarios/:scenarioId/events/:eventId',
    {
      schema: {
        tags: ['Scenarios'],
        summary: 'Get an event and its feed snapshots',
        operationId: 'getMockContestFeedScenarioEvent',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['event'],
            properties: {
              event: eventRecordSchema,
            },
          },
        },
      },
    },
    async (request) => {
      fastify.log.debug(
        { action: 'mockFeedRoute.getEvent.start', data: request.params },
        'Serving mock contest-feed event detail',
      );
      return {
        event: store.getEvent(request.params.scenarioId, request.params.eventId),
      };
    },
  );

  fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
    '/v1/scenarios/:scenarioId/events/:eventId/detail',
    {
      schema: {
        tags: ['Scenarios'],
        summary: 'Get event detail with season context and baseline feeds',
        operationId: 'getMockContestFeedScenarioEventDetail',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        response: {
          200: eventResponseSchema,
        },
      },
    },
    async (request) => {
      fastify.log.debug(
        { action: 'mockFeedRoute.getEventDetail.start', data: request.params },
        'Serving mock contest-feed event detail with season context',
      );
      return store.getEventResponse(request.params.scenarioId, request.params.eventId);
    },
  );

  fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
    '/v1/pre-event/scenarios/:scenarioId/events/:eventId/detail',
    {
      schema: {
        tags: ['Pre-Event'],
        summary: 'Get pre-event event detail with season context and baseline feeds',
        operationId: 'getMockContestFeedPreEventDetail',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        response: {
          200: eventResponseSchema,
        },
      },
    },
    async (request) => store.getEventResponse(request.params.scenarioId, request.params.eventId),
  );

  for (const feedKind of ['field', 'odds', 'rankings', 'results'] as const) {
    const operationId =
      feedKind === 'field'
        ? 'getMockContestFeedFieldSnapshot'
        : feedKind === 'odds'
        ? 'getMockContestFeedOddsSnapshot'
        : feedKind === 'rankings'
          ? 'getMockContestFeedRankingsSnapshot'
          : 'getMockContestFeedResultsSnapshot';

    fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
      `/v1/scenarios/:scenarioId/events/:eventId/${feedKind}`,
      {
        schema: {
          tags: ['Feeds'],
          summary: `Get ${feedKind} feed snapshot for an event`,
          operationId,
          params: {
            type: 'object',
            required: ['scenarioId', 'eventId'],
            properties: {
              scenarioId: { type: 'string' },
              eventId: { type: 'string' },
            },
          },
          response: {
            200: snapshotResponseSchema,
          },
        },
      },
      async (request) => {
        fastify.log.debug(
          { action: 'mockFeedRoute.getSnapshot.start', data: { ...request.params, feedKind } },
          'Serving mock contest-feed snapshot',
        );
        return store.getSnapshot(request.params.scenarioId, request.params.eventId, feedKind);
      },
    );
  }

  for (const feedKind of ['field', 'odds', 'rankings'] as const) {
    const operationId =
      feedKind === 'field'
        ? 'getMockContestFeedPreEventFieldSnapshot'
        : feedKind === 'odds'
          ? 'getMockContestFeedPreEventOddsSnapshot'
          : 'getMockContestFeedPreEventRankingsSnapshot';

    fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
      `/v1/pre-event/scenarios/:scenarioId/events/:eventId/${feedKind}`,
      {
        schema: {
          tags: ['Pre-Event'],
          summary: `Get pre-event ${feedKind} snapshot for an event`,
          operationId,
          params: {
            type: 'object',
            required: ['scenarioId', 'eventId'],
            properties: {
              scenarioId: { type: 'string' },
              eventId: { type: 'string' },
            },
          },
          response: {
            200: snapshotResponseSchema,
          },
        },
      },
      async (request) => store.getSnapshot(request.params.scenarioId, request.params.eventId, feedKind),
    );
  }

  fastify.get<{ Params: { scenarioId: string; eventId: string }; Querystring: { tick?: number } }>(
    '/v1/live/scenarios/:scenarioId/events/:eventId/scores',
    {
      schema: {
        tags: ['Live'],
        summary: 'Get live scoring snapshot for an event',
        operationId: 'getMockContestFeedLiveScores',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tick: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: snapshotResponseSchema,
        },
      },
    },
    async (request) => store.getLiveScores(
      request.params.scenarioId,
      request.params.eventId,
      request.query.tick,
    ),
  );

  fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
    '/v1/live/scenarios/:scenarioId/events/:eventId/results',
    {
      schema: {
        tags: ['Live'],
        summary: 'Get final results snapshot for an event',
        operationId: 'getMockContestFeedLiveResults',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        response: {
          200: snapshotResponseSchema,
        },
      },
    },
    async (request) => store.getSnapshot(request.params.scenarioId, request.params.eventId, 'results'),
  );

  fastify.get<{ Params: { scenarioId: string; eventId: string } }>(
    '/v1/scenarios/:scenarioId/events/:eventId/updates',
    {
      schema: {
        tags: ['Feeds'],
        summary: 'Get live or correction updates for an event',
        operationId: 'getMockContestFeedEventUpdates',
        params: {
          type: 'object',
          required: ['scenarioId', 'eventId'],
          properties: {
            scenarioId: { type: 'string' },
            eventId: { type: 'string' },
          },
        },
        response: {
          200: updatesResponseSchema,
        },
      },
    },
    async (request) => {
      fastify.log.debug(
        { action: 'mockFeedRoute.getUpdates.start', data: request.params },
        'Serving mock contest-feed event updates',
      );
      return store.getUpdates(request.params.scenarioId, request.params.eventId);
    },
  );
}
