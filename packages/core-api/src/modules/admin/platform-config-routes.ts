/**
 * Platform configuration admin routes — poll intervals and ingestion schedules.
 *
 * All routes are registered under the /config prefix within the admin module.
 * Permission: platform.config
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  PollIntervalConfigPatchSchema,
  PollIntervalConfigSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  IngestionScheduleConfigOverrideSchema,
  IngestionScheduleConfigSchema,
} from '@poolmaster/shared/dto/config.dto';
import type { IngestionScheduleConfigOverride } from '@poolmaster/shared/dto/config.dto';
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
      description:
        'Returns the root-admin poll interval configuration that governs recommended client refresh timing.',
      operationId: 'adminGetPollIntervals',
      response: {
        200: zodToJsonSchema(PollIntervalConfigSchema),
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
      description:
        'Updates the root-admin poll interval configuration used by client polling guidance.',
      operationId: 'adminUpdatePollIntervals',
      response: {
        200: zodToJsonSchema(PollIntervalConfigSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: zodToJsonSchema(PollIntervalConfigPatchSchema),
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
      description:
        'Resets poll interval configuration back to the platform defaults.',
      operationId: 'adminResetPollIntervals',
      response: {
        200: zodToJsonSchema(PollIntervalConfigSchema),
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
      description:
        'Returns the global ingestion scheduling configuration used by operational jobs and root-admin system configuration tools.',
      operationId: 'adminGetIngestionSchedule',
      response: {
        200: zodToJsonSchema(IngestionScheduleConfigSchema),
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
      description:
        'Updates the global feed-aware ingestion scheduling configuration for provider health checks and lifecycle-driven sync cadence.',
      operationId: 'adminUpdateIngestionSchedule',
      response: {
        200: zodToJsonSchema(IngestionScheduleConfigSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: zodToJsonSchema(IngestionScheduleConfigOverrideSchema),
    },
    handler: async (
      request: FastifyRequest<{
        Body: IngestionScheduleConfigOverride;
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
      description:
        'Sets a per-sport feed-aware ingestion schedule override that differs from the global ingestion cadence.',
      operationId: 'adminSetSportIngestionOverride',
      response: {
        200: zodToJsonSchema(IngestionScheduleConfigSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: zodToJsonSchema(IngestionScheduleConfigOverrideSchema),
    },
    handler: async (
      request: FastifyRequest<{
        Params: { sport: string };
        Body: IngestionScheduleConfigOverride;
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

  fastify.post('/config/ingestion-schedule/:sport/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Clear per-sport ingestion schedule override',
      description:
        'Removes a persisted per-sport ingestion schedule override so the sport inherits the global runtime configuration again.',
      operationId: 'adminResetSportIngestionOverride',
      response: {
        200: zodToJsonSchema(IngestionScheduleConfigSchema),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { sport: string };
      }>,
    ) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      const { sport } = request.params;
      return ingestionConfig.clearPerSportOverride(
        sport,
        rootAdminUserId,
        rootAdminEmail,
      );
    },
  });

  fastify.post('/config/ingestion-schedule/reset', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset ingestion schedule to defaults',
      description:
        'Resets ingestion scheduling back to the platform defaults.',
      operationId: 'adminResetIngestionSchedule',
      response: { 200: zodToJsonSchema(IngestionScheduleConfigSchema) },
    },
    handler: async (request: FastifyRequest) => {
      const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
      return ingestionConfig.resetDefaults(rootAdminUserId, rootAdminEmail);
    },
  });
}
