/**
 * Platform module — the runtime-tunable platform settings: every settings group by key (#450),
 * plus the original ingestion schedule routes, which read and write the same group. Mounted at /api/v1/platform.
 *
 * Every operation is root-admin (#205): `admin` is the permission, `platform` is what these
 * operations administer.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { IngestionScheduleConfigOverride } from '@poolmaster/shared/dto/config.dto';
import type { SettingsGroupUpdateRequest } from '@poolmaster/shared/dto/settings.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/config.dto';
import '@poolmaster/shared/dto/settings.dto';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import type { IngestionConfigService } from './ingestion-config-service';
import type { PlatformSettingsService } from './platform-settings-service';
import {
  toSettingsChangeListDto,
  toSettingsGroupDto,
  toSettingsGroupListDto,
} from '../../mappers/platform-settings.mapper';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { requireAuthUser } from '../../plugins/auth-guard';

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface PlatformModuleOptions {
  ingestionConfigService: IngestionConfigService;
  platformSettingsService: PlatformSettingsService;
}

export function platformModule(fastify: FastifyInstance, opts: PlatformModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const ingestionConfig = opts.ingestionConfigService;
  const platformSettings = opts.platformSettingsService;

  // -------------------------------------------------------------------------
  // Settings groups (#450)
  // -------------------------------------------------------------------------

  const settingsKeyParams = {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'The settings group key, e.g. EMAIL_CONFIG.' },
    },
  } as const;

  fastify.get('/settings', {
    schema: {
      tags: ['Platform'],
      summary: 'List settings groups',
      description:
        'Returns every settings group with its value in use, its defaults, whether the value is stored or the defaults, and who last saved it.',
      operationId: 'listSettingsGroups',
      response: {
        200: schemaRef('SettingsGroupList'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async () => toSettingsGroupListDto(await platformSettings.list()),
  });

  fastify.get('/settings/:key', {
    schema: {
      tags: ['Platform'],
      summary: 'Get one settings group',
      description: 'Returns one settings group by key.',
      operationId: 'getSettingsGroup',
      params: settingsKeyParams,
      response: {
        200: schemaRef('SettingsGroup'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (request: FastifyRequest<{ Params: { key: string } }>) =>
      toSettingsGroupDto(await platformSettings.get(request.params.key)),
  });

  fastify.put('/settings/:key', {
    schema: {
      tags: ['Platform'],
      summary: 'Save a settings group',
      description:
        'Stores a whole new value for one settings group and records the change. Every core-api task uses it within 30 seconds. Refused with 409 SETTINGS_CONFLICT when `expectedUpdatedAt` is no longer the stored version, and with 400 when the value is invalid or `key` does not match the path.',
      operationId: 'updateSettingsGroup',
      params: settingsKeyParams,
      body: schemaRef('SettingsGroupUpdateRequest'),
      response: {
        200: schemaRef('SettingsGroup'),
        400: schemaRef('ErrorEnvelope'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
        409: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (
      request: FastifyRequest<{ Params: { key: string }; Body: SettingsGroupUpdateRequest }>,
    ) => {
      const { body } = request;
      return toSettingsGroupDto(await platformSettings.save(request.params.key, {
        key: body.key,
        value: body.value,
        expectedUpdatedAt: body.expectedUpdatedAt === null ? null : new Date(body.expectedUpdatedAt),
      }, request.authUser!.userId));
    },
  });

  fastify.post('/settings/:key/reset', {
    schema: {
      tags: ['Platform'],
      summary: 'Reset a settings group to its defaults',
      description: 'Stores the group\'s defaults as its value and records the change.',
      operationId: 'resetSettingsGroup',
      params: settingsKeyParams,
      response: {
        200: schemaRef('SettingsGroup'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (request: FastifyRequest<{ Params: { key: string } }>) =>
      toSettingsGroupDto(await platformSettings.reset(request.params.key, request.authUser!.userId)),
  });

  fastify.get('/settings/:key/history', {
    schema: {
      tags: ['Platform'],
      summary: 'List recent changes to a settings group',
      description: 'Returns the group\'s most recent saved changes, newest first, with who made each.',
      operationId: 'listSettingsGroupHistory',
      params: settingsKeyParams,
      response: {
        200: schemaRef('SettingsChangeList'),
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
        404: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (request: FastifyRequest<{ Params: { key: string } }>) =>
      toSettingsChangeListDto(await platformSettings.history(request.params.key)),
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
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
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
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
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
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
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
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
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
        401: schemaRef('ErrorEnvelope'),
        403: schemaRef('ErrorEnvelope'),
      },
    },
    handler: async (request: FastifyRequest) => {
      const rootAdminUserId = requireAuthUser(request).userId;
      return ingestionConfig.resetDefaults(rootAdminUserId);
    },
  });
}
