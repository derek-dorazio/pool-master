/**
 * Platform configuration admin routes — poll intervals and ingestion schedules.
 *
 * All routes are registered under the /config prefix within the admin module.
 * Permission: platform.config
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema, SuccessSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import type { PollConfigService } from './poll-config-service';
import type { IngestionConfigService } from './ingestion-config-service';
import { extractRootAdminContext } from './request-admin-context';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPlatformConfigRoutes(
  fastify: FastifyInstance,
  services: {
    pollConfig: PollConfigService;
    ingestionConfig: IngestionConfigService;
  },
): void {
  const { pollConfig, ingestionConfig } = services;

  // -------------------------------------------------------------------------
  // Poll Interval Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/poll-intervals', {
    schema: {
      tags: ['Admin'],
      summary: 'Get poll interval configuration',
      operationId: 'adminGetPollIntervals',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async () => {
      return pollConfig.getConfig();
    },
  });

  fastify.put('/config/poll-intervals', {
    schema: {
      tags: ['Admin'],
      summary: 'Update poll interval configuration',
      operationId: 'adminUpdatePollIntervals',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: {
        type: 'object',
        properties: {
          standings: { type: 'integer', minimum: 1000 },
          draft: { type: 'integer', minimum: 1000 },
          contestStatus: { type: 'integer', minimum: 1000 },
          notifications: { type: 'integer', minimum: 1000 },
          default: { type: 'integer', minimum: 1000 },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Body: {
          standings?: number;
          draft?: number;
          contestStatus?: number;
          notifications?: number;
          default?: number;
        };
      }>,
    ) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      return pollConfig.updateConfig(request.body, rootAdminUserId, rootAdminEmail);
    },
  });

  fastify.post('/config/poll-intervals/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset poll intervals to defaults',
      operationId: 'adminResetPollIntervals',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async (request: FastifyRequest) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      return pollConfig.resetDefaults(rootAdminUserId, rootAdminEmail);
    },
  });

  // -------------------------------------------------------------------------
  // Ingestion Schedule Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/ingestion-schedule', {
    schema: {
      tags: ['Admin'],
      summary: 'Get ingestion schedule configuration',
      operationId: 'adminGetIngestionSchedule',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async () => {
      return ingestionConfig.getConfig();
    },
  });

  fastify.put('/config/ingestion-schedule', {
    schema: {
      tags: ['Admin'],
      summary: 'Update ingestion schedule configuration',
      operationId: 'adminUpdateIngestionSchedule',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: {
        type: 'object',
        properties: {
          healthCheckIntervalMinutes: { type: 'integer', minimum: 1 },
          scheduleSyncIntervalHours: { type: 'integer', minimum: 1 },
          participantSyncIntervalHours: { type: 'integer', minimum: 1 },
          rankingSyncIntervalHours: { type: 'integer', minimum: 1 },
          liveScorePollingIntervalSeconds: { type: 'integer', minimum: 5 },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Body: {
          healthCheckIntervalMinutes?: number;
          scheduleSyncIntervalHours?: number;
          participantSyncIntervalHours?: number;
          rankingSyncIntervalHours?: number;
          liveScorePollingIntervalSeconds?: number;
        };
      }>,
    ) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      return ingestionConfig.updateConfig(request.body, rootAdminUserId, rootAdminEmail);
    },
  });

  fastify.put('/config/ingestion-schedule/:sport', {
    schema: {
      tags: ['Admin'],
      summary: 'Set per-sport ingestion schedule override',
      operationId: 'adminSetSportIngestionOverride',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: {
        type: 'object',
        properties: {
          healthCheckIntervalMinutes: { type: 'integer', minimum: 1 },
          scheduleSyncIntervalHours: { type: 'integer', minimum: 1 },
          participantSyncIntervalHours: { type: 'integer', minimum: 1 },
          rankingSyncIntervalHours: { type: 'integer', minimum: 1 },
          liveScorePollingIntervalSeconds: { type: 'integer', minimum: 5 },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { sport: string };
        Body: {
          healthCheckIntervalMinutes?: number;
          scheduleSyncIntervalHours?: number;
          participantSyncIntervalHours?: number;
          rankingSyncIntervalHours?: number;
          liveScorePollingIntervalSeconds?: number;
        };
      }>,
    ) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      const { sport } = request.params;
      return ingestionConfig.setPerSportOverride(
        sport,
        request.body,
        rootAdminUserId,
        rootAdminEmail,
      );
    },
  });

  fastify.post('/config/ingestion-schedule/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset ingestion schedule to defaults',
      operationId: 'adminResetIngestionSchedule',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request: FastifyRequest) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      return ingestionConfig.resetDefaults(rootAdminUserId, rootAdminEmail);
    },
  });
}
