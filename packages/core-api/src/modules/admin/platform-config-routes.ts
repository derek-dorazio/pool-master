/**
 * Platform configuration admin routes — poll intervals, ingestion schedules,
 * dunning schedules, and notification channel defaults.
 *
 * All routes are registered under the /config prefix within the admin module.
 * Permission: platform.config
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema, SuccessSchema } from '@poolmaster/shared/dto';
import type { PollConfigService } from './poll-config-service';
import type { IngestionConfigService } from './ingestion-config-service';
import type { DunningConfigService } from './dunning-config-service';
import type { ChannelConfigService } from './channel-config-service';
import type { RetentionConfigService } from './retention-config-service';
import type { DigestConfigService } from './digest-config-service';

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
    retentionConfig: RetentionConfigService;
    digestConfig: DigestConfigService;
  },
): void {
  const {
    pollConfig,
    ingestionConfig,
    dunningConfig,
    channelConfig,
    retentionConfig,
    digestConfig,
  } = services;

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

  // -------------------------------------------------------------------------
  // Dunning Schedule Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/dunning', {
    schema: {
      tags: ['Admin'],
      summary: 'Get dunning schedule configuration',
      operationId: 'adminGetDunningConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return dunningConfig.getConfig();
    },
  });

  fastify.put('/config/dunning', {
    schema: {
      tags: ['Admin'],
      summary: 'Update dunning schedule configuration',
      operationId: 'adminUpdateDunningConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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

  fastify.post('/config/dunning/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset dunning configuration to defaults',
      operationId: 'adminResetDunningConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request: FastifyRequest) => {
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return dunningConfig.resetDefaults(adminUserId, adminUserEmail);
    },
  });

  // -------------------------------------------------------------------------
  // Notification Channel Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/notification-channels', {
    schema: {
      tags: ['Admin'],
      summary: 'Get notification channel defaults',
      operationId: 'adminGetChannelConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return channelConfig.getConfig();
    },
  });

  fastify.put('/config/notification-channels/:category', {
    schema: {
      tags: ['Admin'],
      summary: 'Update notification channel defaults for a category',
      operationId: 'adminUpdateChannelConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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

  fastify.post('/config/notification-channels/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset notification channel defaults',
      operationId: 'adminResetChannelConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request: FastifyRequest) => {
      const { adminUserId, adminUserEmail } = extractAdminContext(request);
      return channelConfig.resetDefaults(adminUserId, adminUserEmail);
    },
  });

  // -------------------------------------------------------------------------
  // Retention Defaults Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/retention', {
    schema: {
      tags: ['Admin'],
      summary: 'Get data retention defaults',
      operationId: 'adminGetRetentionDefaults',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return retentionConfig.getDefaults();
    },
  });

  fastify.put('/config/retention', {
    schema: {
      tags: ['Admin'],
      summary: 'Update data retention defaults',
      operationId: 'adminUpdateRetentionDefaults',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          contestResultRetentionSeasons: { type: 'integer' },
          rosterHistoryRetentionSeasons: { type: 'integer' },
          activityLogRetentionDays: { type: 'integer' },
          payoutRecordRetentionSeasons: { type: 'integer' },
          chatMessageRetentionDays: { type: 'integer' },
          auditLogRetentionDays: { type: 'integer' },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Body: {
          contestResultRetentionSeasons?: number;
          rosterHistoryRetentionSeasons?: number;
          activityLogRetentionDays?: number;
          payoutRecordRetentionSeasons?: number;
          chatMessageRetentionDays?: number;
          auditLogRetentionDays?: number;
        };
      }>,
    ) => {
      return retentionConfig.updateDefaults(request.body);
    },
  });

  fastify.post('/config/retention/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset data retention to defaults',
      operationId: 'adminResetRetentionDefaults',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return retentionConfig.resetDefaults();
    },
  });

  fastify.get('/config/retention/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get tenant-specific retention override',
      operationId: 'adminGetTenantRetentionOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (
      request: FastifyRequest<{ Params: { tenantId: string } }>,
    ) => {
      const override = retentionConfig.getTenantOverride(request.params.tenantId);
      if (!override) {
        return { override: null, defaults: retentionConfig.getDefaults() };
      }
      return { override };
    },
  });

  fastify.put('/config/retention/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Set tenant-specific retention override',
      operationId: 'adminSetTenantRetentionOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          contestResultRetentionSeasons: { type: 'integer' },
          rosterHistoryRetentionSeasons: { type: 'integer' },
          activityLogRetentionDays: { type: 'integer' },
          payoutRecordRetentionSeasons: { type: 'integer' },
          chatMessageRetentionDays: { type: 'integer' },
          auditLogRetentionDays: { type: 'integer' },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { tenantId: string };
        Body: {
          contestResultRetentionSeasons?: number;
          rosterHistoryRetentionSeasons?: number;
          activityLogRetentionDays?: number;
          payoutRecordRetentionSeasons?: number;
          chatMessageRetentionDays?: number;
          auditLogRetentionDays?: number;
        };
      }>,
    ) => {
      return retentionConfig.setTenantOverride(
        request.params.tenantId,
        request.body,
      );
    },
  });

  fastify.delete('/config/retention/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Clear tenant-specific retention override',
      operationId: 'adminClearTenantRetentionOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (
      request: FastifyRequest<{ Params: { tenantId: string } }>,
    ) => {
      retentionConfig.clearTenantOverride(request.params.tenantId);
      return { cleared: true, tenantId: request.params.tenantId };
    },
  });

  // -------------------------------------------------------------------------
  // Weekly Digest Configuration
  // -------------------------------------------------------------------------

  fastify.get('/config/weekly-digest', {
    schema: {
      tags: ['Admin'],
      summary: 'Get weekly digest configuration',
      operationId: 'adminGetDigestConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return digestConfig.getConfig();
    },
  });

  fastify.put('/config/weekly-digest', {
    schema: {
      tags: ['Admin'],
      summary: 'Update weekly digest configuration',
      operationId: 'adminUpdateDigestConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          subjectTemplate: { type: 'string', minLength: 1 },
          headerTemplate: { type: 'string', minLength: 1 },
          footerTemplate: { type: 'string', minLength: 1 },
          includeStandings: { type: 'boolean' },
          includeHighlights: { type: 'boolean' },
          includeUpcomingEvents: { type: 'boolean' },
          lookbackDays: { type: 'integer', minimum: 1, maximum: 30 },
          sendDay: {
            type: 'string',
            enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
          },
          sendHourUtc: { type: 'integer', minimum: 0, maximum: 23 },
          enabled: { type: 'boolean' },
        },
      },
    },
    handler: async (
      request: FastifyRequest<{
        Body: {
          subjectTemplate?: string;
          headerTemplate?: string;
          footerTemplate?: string;
          includeStandings?: boolean;
          includeHighlights?: boolean;
          includeUpcomingEvents?: boolean;
          lookbackDays?: number;
          sendDay?: string;
          sendHourUtc?: number;
          enabled?: boolean;
        };
      }>,
    ) => {
      return digestConfig.updateConfig(request.body);
    },
  });

  fastify.post('/config/weekly-digest/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset weekly digest configuration to defaults',
      operationId: 'adminResetDigestConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async () => {
      return digestConfig.resetDefaults();
    },
  });

  fastify.get('/config/weekly-digest/preview', {
    schema: {
      tags: ['Admin'],
      summary: 'Preview weekly digest for a league',
      operationId: 'adminPreviewDigest',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (
      request: FastifyRequest<{
        Querystring: { leagueId?: string };
      }>,
    ) => {
      const leagueId = (request.query as { leagueId?: string }).leagueId;
      return { preview: digestConfig.previewDigest(leagueId) };
    },
  });
}
