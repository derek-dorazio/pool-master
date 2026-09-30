/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
// Registers the named components these routes $ref (#192). The DTOs live in
// leagues.dto.ts -- DTO ownership does not follow route-module boundaries.
import '@poolmaster/shared/dto/leagues.dto';
// Registers the canonical UserDto and its response envelopes (#202 step 3.4).
import '@poolmaster/shared/dto/users.dto';
// The provider sync submission, shared with the events module's field refresh (#236).
import '@poolmaster/shared/dto/admin.dto';
import { HealthService } from './health-service';
import { createHealthHandlers } from './health-handler';
import { ProviderService } from './provider-service';
import { createProviderHandlers } from './provider-handler';
import { PollConfigService } from './poll-config-service';
import { IngestionConfigService } from './ingestion-config-service';
import { PrismaPlatformRuntimeConfigRepository } from './platform-runtime-config-repository';
import { registerPlatformConfigRoutes } from './platform-config-routes';
import { ContestTemplateAdminService } from './contest-template-service';
import { createContestTemplateAdminHandlers } from './contest-template-handler';
import { EventScoreSourceService } from '../events/event-score-source-service';
import {
  AdminProviderEventCleanupRequestSchema,
  AdminProviderEventCleanupResponseSchema,
  AdminContestConfigTemplateResponseSchema,
  AdminListContestConfigTemplatesQuerySchema,
  AdminUpdateContestConfigTemplateRequestSchema,
  ContestConfigTemplateListResponseSchema,
  ProviderListResponseSchema,
  ProviderSyncRunListResponseSchema,
  ProviderDetailResponseSchema,
  AdminListProviderCatalogEventsQuerySchema,
  AdminListProviderCatalogEventsResponseSchema,
  ProviderIngestionDashboardResponseSchema,
  ProviderIngestionJobDtoSchema,
  ProviderUnmappedParticipantListResponseSchema,
  ProviderHealthCheckDtoSchema,
  ServiceHealthListResponseSchema,
  InfrastructureMetricsResponseSchema,
  BusinessMetricsResponseSchema,
  ErrorLogListResponseSchema,
  ErrorLogDetailResponseSchema,
  AlertRulesResponseSchema,
  AlertRuleDtoSchema,
  SuccessSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  EventSyncRequestSchema,
  SportSyncRequestSchema,
} from '@poolmaster/shared/dto/ingestion.dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import adminAuth from '../../plugins/admin-auth';
import { getAppPrisma } from '../../core/prisma-context';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import { PrismaContestConfigTemplateRepository } from '../../adapters';
import {
} from '../../adapters';

function withAdminErrorResponses(
  successResponses: Record<number, unknown>,
  extraErrorStatuses: number[] = [],
): Record<number, unknown> {
  return {
    ...successResponses,
    401: zodToJsonSchema(ErrorEnvelopeSchema),
    ...Object.fromEntries(
      extraErrorStatuses.map((status) => [status, zodToJsonSchema(ErrorEnvelopeSchema)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------

export interface AdminModuleOptions {
  providerService?: ProviderService;
  providerRegistry?: ProviderRegistry;
  ingestionConfigService?: IngestionConfigService;
  pollConfigService?: PollConfigService;
}

// #192-mixed: admin's own DTOs convert in their own slice (see plans/143); the league
// components this file $refs arrived with the leagues slice, since leagues DTOs are
// served from here too. Delete this marker when the admin slice lands.
export async function adminModule(
  fastify: FastifyInstance,
  opts: AdminModuleOptions = {},
): Promise<void> {
  void fastify.register(schemaComponentsPlugin);

  await fastify.register(adminAuth);

  // --- Shared Prisma client for all admin services ---
  const prisma = getAppPrisma(fastify);

  // --- Services ---
  // #202 — the league repositories, the `LeagueService` and the user repository that used to
  // be built here went with the three deleted league routes. This module no longer touches
  // leagues at all.
  const healthService = new HealthService(prisma, fastify.log);
  const providerService = opts.providerService ?? new ProviderService(prisma, opts.providerRegistry, undefined, fastify.log);
  const runtimeConfigRepository = new PrismaPlatformRuntimeConfigRepository(prisma);
  const pollConfigService = opts.pollConfigService ?? new PollConfigService(runtimeConfigRepository, fastify.log);
  const ingestionConfigService = opts.ingestionConfigService ?? new IngestionConfigService(runtimeConfigRepository, fastify.log);
  const contestTemplateAdminService = new ContestTemplateAdminService(
    new PrismaContestConfigTemplateRepository(prisma),
    fastify.log,
  );
  const eventScoreSourceService = new EventScoreSourceService(prisma, opts.providerRegistry, fastify.log);
  // --- Handlers ---
  const health = createHealthHandlers(healthService);
  const provider = createProviderHandlers(providerService, eventScoreSourceService);
  const contestTemplates = createContestTemplateAdminHandlers(contestTemplateAdminService);

  // --- User Management Routes ---

  // #235 — `adminListEvents` is gone, not re-pointed. It was `listEvents` plus four fields
  // under an admin prefix, each with its own mapper deriving the same readiness. The one
  // operation is GET /api/v1/events, returning the canonical SportEventDto.

  // #236 — `adminListEventParticipants` is gone too: it was a golf-shaped projection of the
  // event's field. GET /api/v1/events/{eventId}/participants returns SportEventParticipantDto.

/*
   * #202 — the three root-admin league routes are GONE, not re-pointed.
   *
   * `adminListLeagues`, `adminInactivateLeague` and `adminDeleteLeague` were the admin halves
   * of operations the leagues module already implemented, and `docs/DOMAIN-OPERATIONS.md` names
   * the first two as one operation split in two. They are now:
   *
   *   GET    /api/v1/leagues?scope=all      (was GET    /api/v1/admin/leagues)
   *   POST   /api/v1/leagues/:id/inactivate (was POST   /api/v1/admin/leagues/:id/inactivate)
   *   DELETE /api/v1/leagues/:id            (was DELETE /api/v1/admin/leagues/:id)
   *
   * The league routes already served root admins — `requireCommissioner` grants them — so the
   * duplicates added exactly one thing: the platform audit entry. That moved into the league
   * service, and #255 then deleted the audit feature outright.
   */

  // --- Sports Data Provider Routes ---
  // Permission: sportsdata.view, sportsdata.configure, sportsdata.re_ingest

  fastify.get('/providers/health', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'List sports data providers and health status',
      description: 'Returns provider health and provider-summary information for platform ingestion operations.',
      operationId: 'adminListProviders',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderListResponseSchema) }),
    },
    handler: provider.listProviders,
  });

  fastify.get('/providers/sync-runs', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'List recent provider sync runs',
      description: 'Returns recent provider sync runs with thin payload-backed operational detail for root-admin visibility surfaces.',
      operationId: 'adminListProviderSyncRuns',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderSyncRunListResponseSchema) }),
      querystring: {
        type: 'object',
        properties: {
          providerId: { type: 'string' },
          sport: { type: 'string', enum: ['GOLF', 'NFL', 'NBA', 'F1', 'NASCAR', 'NCAA_BASKETBALL', 'NCAA_HOCKEY', 'NCAA_FOOTBALL', 'TENNIS', 'HORSE_RACING', 'SOCCER', 'NHL', 'MLB', 'UFC'] },
          status: { type: 'string', enum: ['SUBMITTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: provider.listSyncRuns,
  });

  fastify.post('/providers/sync/:sport', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Run explicit manual sport sync feeds',
      description: 'Submits feed-aware manual sync for the requested sport. The workflow runs asynchronously after acceptance.',
      operationId: 'adminPrepareSportSync',
      body: zodToJsonSchema(SportSyncRequestSchema),
      response: withAdminErrorResponses({
        202: schemaRef('ProviderManualSyncSubmissionResponse'),
      }, [404, 422]),
    },
    handler: provider.prepareSportSync,
  });

  fastify.post('/providers/events/:sport/:eventId/sync', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Run explicit manual event sync feeds',
      description: 'Submits feed-aware manual sync for a single event. The workflow runs asynchronously after acceptance.',
      operationId: 'adminSyncProviderEventData',
      body: zodToJsonSchema(EventSyncRequestSchema),
      response: withAdminErrorResponses({
        202: schemaRef('ProviderManualSyncSubmissionResponse'),
      }, [404, 409, 422]),
    },
    handler: provider.syncEventData,
  });

  fastify.get('/contest-config-templates', {
    schema: {
      tags: ['Admin'],
      summary: 'List persisted contest configuration templates',
      description: 'Returns the persisted commissioner contest configuration templates that root-admins can manage from the /manage page.',
      operationId: 'adminListContestConfigTemplates',
      querystring: zodToJsonSchema(AdminListContestConfigTemplatesQuerySchema),
      response: withAdminErrorResponses({
        200: zodToJsonSchema(ContestConfigTemplateListResponseSchema),
      }),
    },
    handler: contestTemplates.listTemplates,
  });

  fastify.put('/contest-config-templates/:templateId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a persisted contest configuration template',
      description: 'Updates the persisted commissioner contest template used as a global default for future contest create flows.',
      operationId: 'adminUpdateContestConfigTemplate',
      body: zodToJsonSchema(AdminUpdateContestConfigTemplateRequestSchema),
      response: withAdminErrorResponses({
        200: zodToJsonSchema(AdminContestConfigTemplateResponseSchema),
      }, [400, 404]),
    },
    handler: contestTemplates.updateTemplate,
  });

  fastify.get('/providers/ingestion', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Get ingestion dashboard metrics',
      description: 'Returns ingestion dashboard metrics used by root-admin operational monitoring surfaces.',
      operationId: 'adminGetIngestionDashboard',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderIngestionDashboardResponseSchema) }),
    },
    handler: provider.getIngestionDashboard,
  });

  fastify.get('/providers/unmapped-participants', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'List unmapped participants from providers',
      description: 'Returns provider participant records that still need mapping to internal participants.',
      operationId: 'adminGetUnmappedParticipants',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderUnmappedParticipantListResponseSchema) }),
    },
    handler: provider.getUnmappedParticipants,
  });

  fastify.post('/providers/map-participant', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Map an external participant to an internal ID',
      description: 'Creates or updates a provider-to-participant mapping for ingestion normalization.',
      operationId: 'adminMapParticipant',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }),
      body: {
        type: 'object',
        required: ['providerId', 'externalId', 'internalId'],
        properties: {
          providerId: { type: 'string', minLength: 1 },
          externalId: { type: 'string', minLength: 1 },
          internalId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: provider.mapParticipant,
  });

  fastify.post('/providers/stale-events/cleanup', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Inventory or delete stale provider event rows',
      description:
        'Inventories stale provider SportEvent rows and, in EXECUTE mode, deletes eligible event-scoped rows. Non-Golf events are stale because the current provider workflow is Golf-only. Golf events are stale only after their end time has passed. Contest-referenced events and picks protect an event from deletion.',
      operationId: 'adminCleanupStaleProviderEvents',
      body: zodToJsonSchema(AdminProviderEventCleanupRequestSchema),
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AdminProviderEventCleanupResponseSchema) }),
    },
    handler: provider.cleanupStaleProviderEvents,
  });

  fastify.get('/providers/:providerId', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Get provider detail and configuration',
      description: 'Returns administrative provider detail including mutable configuration and status information.',
      operationId: 'adminGetProviderDetail',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderDetailResponseSchema) }, [404]),
    },
    handler: provider.getProviderDetail,
  });

  fastify.put('/providers/:providerId/config', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Update provider configuration',
      description: 'Updates the configuration for a specific ingestion provider.',
      operationId: 'adminUpdateProviderConfig',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404, 501]),
      body: {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
          apiSecret: { type: 'string' },
          webhookSecret: { type: 'string' },
          webhookUrl: { type: 'string' },
          webhookEvents: { type: 'array', items: { type: 'string' } },
          degradedErrorRate: { type: 'number', minimum: 0 },
          downErrorRate: { type: 'number', minimum: 0 },
          maxLatencyMs: { type: 'integer', minimum: 0 },
          monthlyBudgetUsd: { type: 'number', minimum: 0 },
          budgetAlertThreshold: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    handler: provider.updateProviderConfig,
  });

  fastify.post('/providers/:providerId/health-check', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Trigger manual health check for a provider',
      description: 'Triggers an on-demand provider health check through the admin operations surface.',
      operationId: 'adminTriggerHealthCheck',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderHealthCheckDtoSchema) }, [404]),
    },
    handler: provider.triggerHealthCheck,
  });

  fastify.post('/providers/:providerId/re-ingest/:eventId', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Re-ingest event data from a provider',
      description: 'Triggers on-demand event-data re-ingestion for a provider and event identifier.',
      operationId: 'adminReIngestEvent',
      response: withAdminErrorResponses({ 201: zodToJsonSchema(ProviderIngestionJobDtoSchema) }, [404, 422]),
    },
    handler: provider.reIngestEvent,
  });

  fastify.get('/providers/:providerId/catalog-events', {
    schema: {
      tags: ['Admin Sync'],
      summary: 'Browse a provider\'s live event catalog',
      description: 'Calls provider.getUpcomingEvents live — no dependency on any persisted SportEvent row or on schedule/field sync being enabled. The only candidate-lookup operation: serves the tournament-creation browse mode and the score-source linking picker, a plain filtered list with no scoring or ranking.',
      operationId: 'adminListProviderCatalogEvents',
      querystring: zodToJsonSchema(AdminListProviderCatalogEventsQuerySchema),
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AdminListProviderCatalogEventsResponseSchema) }, [404]),
    },
    handler: provider.listProviderCatalogEvents,
  });

  // --- Health / Platform Monitoring Routes ---
  // Permission: platform.health

  fastify.get('/health/services', {
    schema: {
      tags: ['Admin'],
      summary: 'Get service health status',
      description: 'Returns service-level health diagnostics for root-admin monitoring views.',
      operationId: 'adminGetServiceHealth',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ServiceHealthListResponseSchema) }),
    },
    handler: health.getServiceHealth,
  });

  fastify.get('/health/infrastructure', {
    schema: {
      tags: ['Admin'],
      summary: 'Get infrastructure metrics',
      description: 'Returns infrastructure metrics used by platform monitoring and operational dashboards.',
      operationId: 'adminGetInfrastructureMetrics',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(InfrastructureMetricsResponseSchema) }),
    },
    handler: health.getInfrastructureMetrics,
  });

  fastify.get('/health/metrics', {
    schema: {
      tags: ['Admin'],
      summary: 'Get business metrics',
      description: 'Returns business and product metrics used by root-admin reporting surfaces.',
      operationId: 'adminGetBusinessMetrics',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(BusinessMetricsResponseSchema) }),
    },
    handler: health.getBusinessMetrics,
  });

  fastify.get('/health/errors', {
    schema: {
      tags: ['Admin'],
      summary: 'Search platform errors',
      description: 'Searches captured platform errors for operational debugging and support investigation.',
      operationId: 'adminSearchErrors',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ErrorLogListResponseSchema) }),
      querystring: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          severity: { type: 'string', enum: ['ERROR', 'CRITICAL', 'WARNING'] },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: health.searchErrors,
  });

  fastify.get('/health/errors/:errorId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get error detail',
      description: 'Returns detailed information for a captured platform error.',
      operationId: 'adminGetErrorDetail',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ErrorLogDetailResponseSchema) }, [404]),
    },
    handler: health.getErrorDetail,
  });

  fastify.get('/health/alerts', {
    schema: {
      tags: ['Admin'],
      summary: 'Get alert rules',
      description: 'Returns the configured alert rules for operational monitoring.',
      operationId: 'adminGetAlertRules',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AlertRulesResponseSchema) }),
    },
    handler: health.getAlertRules,
  });

  fastify.put('/health/alerts/:alertId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update an alert rule',
      description: 'Updates an alert rule configuration through the root-admin monitoring surface.',
      operationId: 'adminUpdateAlertRule',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AlertRuleDtoSchema) }, [404]),
      body: {
        type: 'object',
        properties: {
          isEnabled: { type: 'boolean' },
          severity: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          channels: {
            type: 'array',
            items: { type: 'string', enum: ['SLACK', 'PAGERDUTY', 'EMAIL'] },
          },
          thresholds: { type: 'object' },
          windowMinutes: { type: 'integer', minimum: 1 },
        },
      },
    },
    handler: health.updateAlertRule,
  });

  fastify.post('/health/alerts/:alertId/mute', {
    schema: {
      tags: ['Admin'],
      summary: 'Mute an alert for a duration',
      description: 'Temporarily mutes an alert rule for a specified duration.',
      operationId: 'adminMuteAlert',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AlertRuleDtoSchema) }, [400, 404]),
      body: {
        type: 'object',
        required: ['duration'],
        properties: {
          duration: { type: 'string', enum: ['1h', '4h', '24h', 'indefinite'] },
        },
      },
    },
    handler: health.muteAlert,
  });

  fastify.post('/health/alerts/:alertId/unmute', {
    schema: {
      tags: ['Admin'],
      summary: 'Unmute an alert',
      description: 'Removes a mute from an alert rule so it resumes normal signaling.',
      operationId: 'adminUnmuteAlert',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AlertRuleDtoSchema) }, [404]),
    },
    handler: health.unmuteAlert,
  });

  // --- Platform Configuration Routes ---
  // Permission: platform.config

  // #236 — the 45 `/sports/golf/*` operations are gone: each moved onto the object it acts
  // on (plans/145, "Slice 2 golf — the operation map") under /sport-leagues, /seasons,
  // /events and /participants.

  registerPlatformConfigRoutes(fastify, {
    pollConfig: pollConfigService,
    ingestionConfig: ingestionConfigService,
  });
}
