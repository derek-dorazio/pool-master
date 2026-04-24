/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance } from 'fastify';
import { setAuditLogger, setAuditPrisma } from './admin-audit-service';
import { setAuditQueryLogger, setAuditQueryPrisma } from './audit-query-service';
import { UserService } from './user-service';
import { createUserHandlers } from './user-handler';
import { AdminLeagueService } from './league-service';
import { createLeagueAdminHandlers } from './league-handler';
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
import { auditRoutes } from './audit-routes';
import {
  AdminListLeaguesQuerySchema,
  AdminContestConfigTemplateResponseSchema,
  AdminListContestConfigTemplatesQuerySchema,
  AdminUpdateContestConfigTemplateRequestSchema,
  ContestConfigTemplateListResponseSchema,
  DeleteLeagueRequestSchema,
  LeagueListResponseSchema,
  LeagueResponseSchema,
  ProviderManualSyncSubmissionResponseSchema,
  UserListResponseSchema,
  UserDetailResponseSchema,
  ProviderListResponseSchema,
  ProviderSyncRunListResponseSchema,
  ProviderDetailResponseSchema,
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
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaSquadRepository,
} from '../../adapters';
import { LeagueService } from '../leagues/service';

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

export async function adminModule(
  fastify: FastifyInstance,
  opts: AdminModuleOptions = {},
): Promise<void> {
  await fastify.register(adminAuth);

  // --- Shared Prisma client for all admin services ---
  const prisma = getAppPrisma(fastify);

  // Initialise the audit service's Prisma reference so that the module-level
  // logAdminAction() helper can persist audit entries to the database.
  setAuditPrisma(prisma);
  setAuditLogger(fastify.log);
  setAuditQueryPrisma(prisma);
  setAuditQueryLogger(fastify.log);

  // --- Services ---
  const userService = new UserService(prisma, fastify.log);
  const leagueService = new LeagueService(
    new PrismaLeagueRepository(prisma),
    new PrismaLeagueMembershipRepository(prisma),
    new PrismaSquadRepository(prisma),
    new PrismaSquadMembershipRepository(prisma),
    prisma,
    fastify.log,
  );
  const adminLeagueService = new AdminLeagueService(prisma, leagueService, fastify.log);
  const healthService = new HealthService(prisma, fastify.log);
  const providerService = opts.providerService ?? new ProviderService(prisma, opts.providerRegistry, undefined, fastify.log);
  const runtimeConfigRepository = new PrismaPlatformRuntimeConfigRepository(prisma);
  const pollConfigService = opts.pollConfigService ?? new PollConfigService(runtimeConfigRepository, fastify.log);
  const ingestionConfigService = opts.ingestionConfigService ?? new IngestionConfigService(runtimeConfigRepository, fastify.log);
  const contestTemplateAdminService = new ContestTemplateAdminService(
    new PrismaContestConfigTemplateRepository(prisma),
    fastify.log,
  );

  // --- Handlers ---
  const user = createUserHandlers(userService);
  const leagues = createLeagueAdminHandlers(adminLeagueService);
  const health = createHealthHandlers(healthService);
  const provider = createProviderHandlers(providerService);
  const contestTemplates = createContestTemplateAdminHandlers(contestTemplateAdminService);

  // --- User Management Routes ---

  fastify.get('/users', {
    schema: {
      tags: ['Admin'],
      summary: 'List users with filters',
      description: 'Returns the administrative user list with filter support for platform operations and support workflows.',
      operationId: 'adminListUsers',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(UserListResponseSchema) }),
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          isActive: { type: 'boolean' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: user.listUsers,
  });

  fastify.get('/users/:userId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get user detail',
      description: 'Returns the administrative detail view for a specific user account.',
      operationId: 'adminGetUserDetail',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(UserDetailResponseSchema) }, [404]),
    },
    handler: user.getUserDetail,
  });

  fastify.post('/users/:userId/force-logout', {
    schema: {
      tags: ['Admin'],
      summary: 'Force logout a user from all sessions',
      description: 'Revokes every active session for the target user so they are forced to authenticate again.',
      operationId: 'adminForceLogout',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
    },
    handler: user.forceLogout,
  });

  fastify.post('/users/:userId/disable', {
    schema: {
      tags: ['Admin'],
      summary: 'Disable a user account',
      description: 'Disables the target user account at the platform level.',
      operationId: 'adminDisableUser',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: user.disableUser,
  });

  fastify.post('/users/:userId/enable', {
    schema: {
      tags: ['Admin'],
      summary: 'Re-enable a disabled user account',
      description: 'Re-enables a previously disabled user account.',
      operationId: 'adminEnableUser',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
    },
    handler: user.enableUser,
  });

  fastify.get('/leagues', {
    schema: {
      tags: ['Admin'],
      summary: 'List leagues for root-admin management',
      description: 'Returns root-admin league search results by league name for manage-page lifecycle actions.',
      operationId: 'adminListLeagues',
      querystring: zodToJsonSchema(AdminListLeaguesQuerySchema),
      response: withAdminErrorResponses({ 200: zodToJsonSchema(LeagueListResponseSchema) }),
    },
    handler: leagues.listLeagues,
  });

  fastify.post('/leagues/:leagueId/inactivate', {
    schema: {
      tags: ['Admin'],
      summary: 'Inactivate a league as root admin',
      description: 'Allows root-admins to inactivate a league before permanent deletion. This reuses the truthful league lifecycle behavior.',
      operationId: 'adminInactivateLeague',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(LeagueResponseSchema) }, [400, 404]),
    },
    handler: leagues.inactivateLeague,
  });

  fastify.delete('/leagues/:leagueId', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete an inactive league as root admin',
      description: 'Allows root-admins to permanently delete an inactive league after confirming the exact league code. This reuses the truthful cascade-delete lifecycle behavior.',
      operationId: 'adminDeleteLeague',
      body: zodToJsonSchema(DeleteLeagueRequestSchema),
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [400, 404]),
    },
    handler: leagues.deleteLeague,
  });

  // --- Sports Data Provider Routes ---
  // Permission: sportsdata.view, sportsdata.configure, sportsdata.re_ingest

  fastify.get('/providers/health', {
    schema: {
      tags: ['Admin'],
      summary: 'List sports data providers and health status',
      description: 'Returns provider health and provider-summary information for platform ingestion operations.',
      operationId: 'adminListProviders',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderListResponseSchema) }),
    },
    handler: provider.listProviders,
  });

  fastify.get('/providers/sync-runs', {
    schema: {
      tags: ['Admin'],
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
      tags: ['Admin'],
      summary: 'Run explicit manual sport sync feeds',
      description: 'Submits feed-aware manual sync for the requested sport. The workflow runs asynchronously after acceptance.',
      operationId: 'adminPrepareSportSync',
      body: zodToJsonSchema(SportSyncRequestSchema),
      response: withAdminErrorResponses({
        202: zodToJsonSchema(ProviderManualSyncSubmissionResponseSchema),
      }, [404]),
    },
    handler: provider.prepareSportSync,
  });

  fastify.post('/providers/events/:sport/:eventId/sync', {
    schema: {
      tags: ['Admin'],
      summary: 'Run explicit manual event sync feeds',
      description: 'Submits feed-aware manual sync for a single event. The workflow runs asynchronously after acceptance.',
      operationId: 'adminSyncProviderEventData',
      body: zodToJsonSchema(EventSyncRequestSchema),
      response: withAdminErrorResponses({
        202: zodToJsonSchema(ProviderManualSyncSubmissionResponseSchema),
      }, [404]),
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
      tags: ['Admin'],
      summary: 'Get ingestion dashboard metrics',
      description: 'Returns ingestion dashboard metrics used by root-admin operational monitoring surfaces.',
      operationId: 'adminGetIngestionDashboard',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderIngestionDashboardResponseSchema) }),
    },
    handler: provider.getIngestionDashboard,
  });

  fastify.get('/providers/unmapped-participants', {
    schema: {
      tags: ['Admin'],
      summary: 'List unmapped participants from providers',
      description: 'Returns provider participant records that still need mapping to internal participants.',
      operationId: 'adminGetUnmappedParticipants',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderUnmappedParticipantListResponseSchema) }),
    },
    handler: provider.getUnmappedParticipants,
  });

  fastify.post('/providers/map-participant', {
    schema: {
      tags: ['Admin'],
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

  fastify.get('/providers/:providerId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get provider detail and configuration',
      description: 'Returns administrative provider detail including mutable configuration and status information.',
      operationId: 'adminGetProviderDetail',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderDetailResponseSchema) }, [404]),
    },
    handler: provider.getProviderDetail,
  });

  fastify.put('/providers/:providerId/config', {
    schema: {
      tags: ['Admin'],
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
      tags: ['Admin'],
      summary: 'Trigger manual health check for a provider',
      description: 'Triggers an on-demand provider health check through the admin operations surface.',
      operationId: 'adminTriggerHealthCheck',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ProviderHealthCheckDtoSchema) }, [404]),
    },
    handler: provider.triggerHealthCheck,
  });

  fastify.post('/providers/:providerId/re-ingest/:eventId', {
    schema: {
      tags: ['Admin'],
      summary: 'Re-ingest event data from a provider',
      description: 'Triggers on-demand event-data re-ingestion for a provider and event identifier.',
      operationId: 'adminReIngestEvent',
      response: withAdminErrorResponses({ 201: zodToJsonSchema(ProviderIngestionJobDtoSchema) }, [404, 422]),
    },
    handler: provider.reIngestEvent,
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

  await fastify.register(auditRoutes);

  registerPlatformConfigRoutes(fastify, {
    pollConfig: pollConfigService,
    ingestionConfig: ingestionConfigService,
  });
}
