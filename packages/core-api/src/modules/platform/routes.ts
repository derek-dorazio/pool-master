/**
 * Platform module — the runtime-tunable platform settings: client poll intervals and the
 * ingestion schedule. Mounted at /api/v1/platform.
 *
 * Every operation is root-admin (#205): `admin` is the permission, `platform` is what these
 * operations administer.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import type { IngestionScheduleConfigOverride } from '@poolmaster/shared/dto/config.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/config.dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import type { PollConfigService } from './poll-config-service';
import type { IngestionConfigService } from './ingestion-config-service';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireAuthUser } from '../../plugins/auth-guard';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface PlatformModuleOptions {
  pollConfigService: PollConfigService;
  ingestionConfigService: IngestionConfigService;
}

export function platformModule(fastify: FastifyInstance, opts: PlatformModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const pollConfig = opts.pollConfigService;
  const ingestionConfig = opts.ingestionConfigService;

  // -------------------------------------------------------------------------
  // Poll Interval Configuration
  // -------------------------------------------------------------------------

  fastify.get('/poll-intervals', {
    schema: {
      tags: ['Platform'],
      summary: 'Get poll interval configuration',
      description:
        'Returns the platform poll interval configuration that governs recommended client refresh timing.',
      operationId: 'getPollIntervals',
      response: {
        200: schemaRef('PollIntervalConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async () => {
      return pollConfig.getConfig();
    },
  });

  fastify.put('/poll-intervals', {
    schema: {
      tags: ['Platform'],
      summary: 'Update poll interval configuration',
      description:
        'Updates the platform poll interval configuration used by client polling guidance.',
      operationId: 'updatePollIntervals',
      response: {
        200: schemaRef('PollIntervalConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: schemaRef('PollIntervalConfigPatch'),
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
      const rootAdminUserId = requireAuthUser(request).userId;
      return pollConfig.updateConfig(request.body, rootAdminUserId);
    },
  });

  fastify.post('/poll-intervals/reset', {
    schema: {
      tags: ['Platform'],
      summary: 'Reset poll intervals to defaults',
      description:
        'Resets poll interval configuration back to the platform defaults.',
      operationId: 'resetPollIntervals',
      response: {
        200: schemaRef('PollIntervalConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async (request: FastifyRequest) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      return pollConfig.resetDefaults(rootAdminUserId);
    },
  });

  // -------------------------------------------------------------------------
  // Ingestion Schedule Configuration
  // -------------------------------------------------------------------------

  fastify.get('/ingestion-schedule', {
    schema: {
      tags: ['Platform'],
      summary: 'Get ingestion schedule configuration',
      description:
        'Returns the global ingestion scheduling configuration used by operational jobs and root-admin system configuration tools.',
      operationId: 'getIngestionSchedule',
      response: {
        200: schemaRef('IngestionScheduleConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async () => {
      return ingestionConfig.getConfig();
    },
  });

  fastify.put('/ingestion-schedule', {
    schema: {
      tags: ['Platform'],
      summary: 'Update ingestion schedule configuration',
      description:
        'Updates the global feed-aware ingestion scheduling configuration for provider health checks and lifecycle-driven sync cadence.',
      operationId: 'updateIngestionSchedule',
      response: {
        200: schemaRef('IngestionScheduleConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: schemaRef('IngestionScheduleConfigOverride'),
    },
    handler: async (
      request: FastifyRequest<{
        Body: IngestionScheduleConfigOverride;
      }>,
    ) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      return ingestionConfig.updateConfig(request.body, rootAdminUserId);
    },
  });

  fastify.put('/ingestion-schedule/:sport', {
    schema: {
      tags: ['Platform'],
      summary: 'Set per-sport ingestion schedule override',
      description:
        'Sets a per-sport feed-aware ingestion schedule override that differs from the global ingestion cadence.',
      operationId: 'setSportIngestionOverride',
      response: {
        200: schemaRef('IngestionScheduleConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
      body: schemaRef('IngestionScheduleConfigOverride'),
    },
    handler: async (
      request: FastifyRequest<{
        Params: { sport: string };
        Body: IngestionScheduleConfigOverride;
      }>,
    ) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      const { sport } = request.params;
      return ingestionConfig.setPerSportOverride(
        sport,
        request.body,
        rootAdminUserId,
      );
    },
  });

  fastify.post('/ingestion-schedule/:sport/reset', {
    schema: {
      tags: ['Platform'],
      summary: 'Clear per-sport ingestion schedule override',
      description:
        'Removes a persisted per-sport ingestion schedule override so the sport inherits the global runtime configuration again.',
      operationId: 'resetSportIngestionOverride',
      response: {
        200: schemaRef('IngestionScheduleConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async (
      request: FastifyRequest<{
        Params: { sport: string };
      }>,
    ) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      const { sport } = request.params;
      return ingestionConfig.clearPerSportOverride(
        sport,
        rootAdminUserId,
      );
    },
  });

  fastify.post('/ingestion-schedule/reset', {
    schema: {
      tags: ['Platform'],
      summary: 'Reset ingestion schedule to defaults',
      description:
        'Resets ingestion scheduling back to the platform defaults.',
      operationId: 'resetIngestionSchedule',
      response: {
        200: schemaRef('IngestionScheduleConfig'),
        401: zodToJsonSchema(ErrorEnvelopeSchema),
        403: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
    handler: async (request: FastifyRequest) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      return ingestionConfig.resetDefaults(rootAdminUserId);
    },
  });
}
