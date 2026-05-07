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
import { ScenarioStore, type ScenarioStoreOptions } from './scenario-store';

export interface MockContestFeedRouteOptions {
  readonly scenarioStoreOptions?: ScenarioStoreOptions;
}

function buildScenarioStore(
  fastify: FastifyInstance,
  options: MockContestFeedRouteOptions = {},
): ScenarioStore {
  const scenarioDir = process.env.SCENARIO_DIR ?? resolve(__dirname, '../contest-feed-scenarios');
  return new ScenarioStore(scenarioDir, fastify.log, options.scenarioStoreOptions);
}

function logRoutePayload(
  fastify: FastifyInstance,
  action: string,
  data: Record<string, unknown>,
  payload: unknown,
  message: string,
): void {
  fastify.log.info({ action, data }, message);
  fastify.log.debug({ action: `${action}.payload`, data: { ...data, payload } }, `${message} payload`);
}

export async function mockContestFeedRoutes(
  fastify: FastifyInstance,
  options: MockContestFeedRouteOptions = {},
): Promise<void> {
  const store = buildScenarioStore(fastify, options);

  fastify.addHook('preHandler', async (request) => {
    request.log.debug(
      {
        action: 'mockFeedRoute.request.start',
        data: {
          method: request.method,
          url: request.url,
          route: request.routeOptions.url,
          params: request.params,
          query: request.query,
        },
      },
      'Mock contest-feed request started',
    );
  });

  fastify.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        action: 'mockFeedRoute.request.complete',
        data: {
          method: request.method,
          url: request.url,
          route: request.routeOptions.url,
          statusCode: reply.statusCode,
        },
      },
      'Mock contest-feed request completed',
    );
  });

  fastify.addHook('onError', async (request, reply, error) => {
    request.log.error(
      {
        action: 'mockFeedRoute.request.failed',
        data: {
          method: request.method,
          url: request.url,
          route: request.routeOptions.url,
          statusCode: reply.statusCode,
        },
        err: error,
      },
      'Mock contest-feed request failed',
    );
  });

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
      fastify.log.debug(
        { action: 'mockFeedRoute.health.payload', data: { payload } },
        'Served mock contest-feed health response payload',
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
      const payload = { scenarios };
      logRoutePayload(
        fastify,
        'mockFeedRoute.listScenarios',
        { scenarioCount: scenarios.length },
        payload,
        'Served mock contest-feed scenario list',
      );
      return payload;
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
      const payload = {
        scenario: store.getScenario(request.params.scenarioId),
      };
      logRoutePayload(
        fastify,
        'mockFeedRoute.getScenario',
        {
          scenarioId: request.params.scenarioId,
          eventCount: payload.scenario.events.length,
        },
        payload,
        'Served mock contest-feed scenario detail',
      );
      return payload;
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
      const payload = {
        scenarioId: request.params.scenarioId,
        events,
      };
      logRoutePayload(
        fastify,
        'mockFeedRoute.listEvents',
        { scenarioId: request.params.scenarioId, eventCount: events.length },
        payload,
        'Served mock contest-feed event list',
      );
      return payload;
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
      const payload = {
        event: store.getEvent(request.params.scenarioId, request.params.eventId),
      };
      logRoutePayload(
        fastify,
        'mockFeedRoute.getEvent',
        request.params,
        payload,
        'Served mock contest-feed event detail',
      );
      return payload;
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
      const payload = store.getEventResponse(request.params.scenarioId, request.params.eventId);
      logRoutePayload(
        fastify,
        'mockFeedRoute.getEventDetail',
        {
          scenarioId: request.params.scenarioId,
          eventId: request.params.eventId,
          contestantCount: payload.event.field.contestants.length,
        },
        payload,
        'Served mock contest-feed event detail with season context',
      );
      return payload;
    },
  );

  // pool-master-rop.78.13 — the legacy `/v1/pre-event/...` and `/v1/live/...`
  // routes were OpenAPI-undocumented duplicates of the canonical
  // `/v1/scenarios/.../events/.../...` surface. They were dropped in this
  // slice so the generated SDK is the single source of truth for callers.

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
        const payload = store.getSnapshot(request.params.scenarioId, request.params.eventId, feedKind);
        logRoutePayload(
          fastify,
          'mockFeedRoute.getSnapshot',
          {
            scenarioId: request.params.scenarioId,
            eventId: request.params.eventId,
            feedKind,
            contestantCount: payload.contestants.length,
          },
          payload,
          'Served mock contest-feed snapshot',
        );
        return payload;
      },
    );
  }

  // pool-master-rop.78.13 — `scores` joins the canonical feed-snapshot
  // surface. It accepts an optional `tick` query parameter that
  // advances the in-memory store's live-scoring state machine; the
  // legacy `/v1/live/.../scores` alias was dropped.
  fastify.get<{ Params: { scenarioId: string; eventId: string }; Querystring: { tick?: number } }>(
    '/v1/scenarios/:scenarioId/events/:eventId/scores',
    {
      schema: {
        tags: ['Feeds'],
        summary: 'Get live scoring snapshot for an event',
        operationId: 'getMockContestFeedScoresSnapshot',
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
    async (request) => {
      fastify.log.debug(
        { action: 'mockFeedRoute.getScoresSnapshot.start', data: { ...request.params, tick: request.query.tick ?? null } },
        'Serving mock contest-feed scores snapshot',
      );
      const payload = store.getLiveScores(
        request.params.scenarioId,
        request.params.eventId,
        request.query.tick,
      );
      logRoutePayload(
        fastify,
        'mockFeedRoute.getScoresSnapshot',
        {
          scenarioId: request.params.scenarioId,
          eventId: request.params.eventId,
          tick: request.query.tick ?? null,
          contestantCount: payload.contestants.length,
        },
        payload,
        'Served mock contest-feed scores snapshot',
      );
      return payload;
    },
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
      const payload = store.getUpdates(request.params.scenarioId, request.params.eventId);
      logRoutePayload(
        fastify,
        'mockFeedRoute.getUpdates',
        {
          scenarioId: request.params.scenarioId,
          eventId: request.params.eventId,
          updateCount: payload.updates.length,
        },
        payload,
        'Served mock contest-feed event updates',
      );
      return payload;
    },
  );
}
