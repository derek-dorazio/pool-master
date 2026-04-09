/**
 * Platform configuration admin routes — poll intervals and ingestion schedules.
 *
 * All routes are registered under the /config prefix within the admin module.
 * Permission: platform.config
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema, SuccessSchema } from '@poolmaster/shared/dto';
import type { PollConfigService } from './poll-config-service';
import type { IngestionConfigService } from './ingestion-config-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

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
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return pollConfig.updateConfig(request.body, adminUserId, adminUserEmail);
    },
  });

  fastify.post('/config/poll-intervals/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset poll intervals to defaults',
      operationId: 'adminResetPollIntervals',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request: FastifyRequest) => {
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return pollConfig.resetDefaults(adminUserId, adminUserEmail);
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
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return ingestionConfig.updateConfig(request.body, adminUserId, adminUserEmail);
    },
  });

  fastify.put('/config/ingestion-schedule/:sport', {
    schema: {
      tags: ['Admin'],
      summary: 'Set per-sport ingestion schedule override',
      operationId: 'adminSetSportIngestionOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      const { sport } = request.params;
      return ingestionConfig.setPerSportOverride(
        sport,
        request.body,
        adminUserId,
        adminUserEmail,
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
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return ingestionConfig.resetDefaults(adminUserId, adminUserEmail);
    },
  });
}
