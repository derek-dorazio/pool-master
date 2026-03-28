/**
 * Platform configuration admin routes — poll intervals, ingestion schedules,
 * dunning schedules, and notification channel defaults.
 *
 * All routes are registered under the /config prefix within the admin module.
 * Permission: platform.config
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PollConfigService } from './poll-config-service';
import type { IngestionConfigService } from './ingestion-config-service';
import type { DunningConfigService } from './dunning-config-service';
import type { ChannelConfigService } from './channel-config-service';

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
    dunningConfig: DunningConfigService;
    channelConfig: ChannelConfigService;
  },
): void {
  const { pollConfig, ingestionConfig, dunningConfig, channelConfig } = services;

  // -------------------------------------------------------------------------
  // Poll Interval Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/poll-intervals', async () => {
    return pollConfig.getConfig();
  });

  fastify.put('/config/poll-intervals', {
    schema: {
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

  fastify.post('/config/poll-intervals/reset', async (request: FastifyRequest) => {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return pollConfig.resetDefaults(adminUserId, adminUserEmail);
  });

  // -------------------------------------------------------------------------
  // Ingestion Schedule Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/ingestion-schedule', async () => {
    return ingestionConfig.getConfig();
  });

  fastify.put('/config/ingestion-schedule', {
    schema: {
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

  fastify.post('/config/ingestion-schedule/reset', async (request: FastifyRequest) => {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return ingestionConfig.resetDefaults(adminUserId, adminUserEmail);
  });

  // -------------------------------------------------------------------------
  // Dunning Schedule Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/dunning', async () => {
    return dunningConfig.getConfig();
  });

  fastify.put('/config/dunning', {
    schema: {
      body: {
        type: 'object',
        properties: {
          retryAttempts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['daysAfterFailure', 'action'],
              properties: {
                daysAfterFailure: { type: 'integer', minimum: 1 },
                action: { type: 'string', minLength: 1 },
              },
            },
          },
          gracePeriodDays: { type: 'integer', minimum: 1 },
          degradedPeriodDays: { type: 'integer', minimum: 1 },
          cancellationDays: { type: 'integer', minimum: 1 },
          notifyOnRetry: { type: 'boolean' },
          notifyOnGracePeriodStart: { type: 'boolean' },
          notifyOnDegradation: { type: 'boolean' },
          notifyBeforeCancellation: { type: 'boolean' },
          notifyBeforeCancellationDays: { type: 'integer', minimum: 1 },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Body: {
          retryAttempts?: { daysAfterFailure: number; action: string }[];
          gracePeriodDays?: number;
          degradedPeriodDays?: number;
          cancellationDays?: number;
          notifyOnRetry?: boolean;
          notifyOnGracePeriodStart?: boolean;
          notifyOnDegradation?: boolean;
          notifyBeforeCancellation?: boolean;
          notifyBeforeCancellationDays?: number;
        };
      }>,
    ) => {
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return dunningConfig.updateConfig(request.body, adminUserId, adminUserEmail);
    },
  });

  fastify.post('/config/dunning/reset', async (request: FastifyRequest) => {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return dunningConfig.resetDefaults(adminUserId, adminUserEmail);
  });

  // -------------------------------------------------------------------------
  // Notification Channel Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/notification-channels', async () => {
    return channelConfig.getConfig();
  });

  fastify.put('/config/notification-channels/:category', {
    schema: {
      body: {
        type: 'object',
        required: ['channels'],
        properties: {
          channels: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['PUSH', 'EMAIL', 'IN_APP', 'SMS'],
            },
            minItems: 1,
          },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { category: string };
        Body: { channels: string[] };
      }>,
    ) => {
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      const { category } = request.params;
      return channelConfig.updateCategoryChannels(
        category,
        request.body.channels,
        adminUserId,
        adminUserEmail,
      );
    },
  });

  fastify.post('/config/notification-channels/reset', async (request: FastifyRequest) => {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    return channelConfig.resetDefaults(adminUserId, adminUserEmail);
  });
}
