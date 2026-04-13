/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance } from 'fastify';
import { setAuditPrisma } from './admin-audit-service';
import { setAuditQueryPrisma } from './audit-query-service';
import { UserService } from './user-service';
import { createUserHandlers } from './user-handler';
import { ContestService } from './contest-service';
import { createContestHandlers } from './contest-handler';
import { HealthService } from './health-service';
import { createHealthHandlers } from './health-handler';
import { ProviderService } from './provider-service';
import { createProviderHandlers } from './provider-handler';
import { PollConfigService } from './poll-config-service';
import { IngestionConfigService } from './ingestion-config-service';
import { registerPlatformConfigRoutes } from './platform-config-routes';
import { auditRoutes } from './audit-routes';
import {
  UserListResponseSchema,
  UserDetailResponseSchema,
  ProviderListResponseSchema,
  ProviderDetailResponseSchema,
  ProviderIngestionDashboardResponseSchema,
  ProviderUnmappedParticipantListResponseSchema,
  ProviderHealthCheckDtoSchema,
  AdminContestListResponseSchema,
  ContestAdminDetailResponseSchema,
  ContestRecalculationResultDtoSchema,
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
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import adminAuth from '../../plugins/admin-auth';
import { getAppPrisma } from '../../core/prisma-context';

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

export async function adminModule(fastify: FastifyInstance): Promise<void> {
  await fastify.register(adminAuth);

  // --- Shared Prisma client for all admin services ---
  const prisma = getAppPrisma(fastify);

  // Initialise the audit service's Prisma reference so that the module-level
  // logAdminAction() helper can persist audit entries to the database.
  setAuditPrisma(prisma);
  setAuditQueryPrisma(prisma);

  // --- Services ---
  const userService = new UserService(prisma);
  const contestService = new ContestService(prisma);
  const healthService = new HealthService(prisma);
  const providerService = new ProviderService(prisma);
  const pollConfigService = new PollConfigService();
  const ingestionConfigService = new IngestionConfigService();

  // --- Handlers ---
  const user = createUserHandlers(userService);
  const contest = createContestHandlers(contestService);
  const health = createHealthHandlers(healthService);
  const provider = createProviderHandlers(providerService);

  // --- User Management Routes ---
  // NOTE: /users/merge is registered before /users/:userId to avoid route collision.

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
          status: { type: 'string', enum: ['active', 'disabled'] },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: user.listUsers,
  });

  fastify.post('/users/merge', {
    schema: {
      tags: ['Admin'],
      summary: 'Merge duplicate user accounts',
      description: 'Merges two user accounts when platform operations need to consolidate duplicate identities.',
      operationId: 'adminMergeUsers',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }),
      body: {
        type: 'object',
        required: ['primaryId', 'duplicateId'],
        properties: {
          primaryId: { type: 'string', minLength: 1 },
          duplicateId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: user.mergeUsers,
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

  // --- Contest Management Routes ---

  fastify.get('/contests', {
    schema: {
      tags: ['Admin'],
      summary: 'List contests with filters',
      description: 'Returns the platform-wide contest list with administrative filtering and search support.',
      operationId: 'adminListContests',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(AdminContestListResponseSchema) }),
      querystring: {
        type: 'object',
        properties: {
          league: { type: 'string' },
          sport: { type: 'string' },
          status: { type: 'string' },
          type: { type: 'string' },
          selection: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: contest.listContests,
  });

  fastify.get('/contests/:contestId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get contest detail',
      description: 'Returns the administrative detail view for a specific contest.',
      operationId: 'adminGetContestDetail',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ContestAdminDetailResponseSchema) }, [404]),
    },
    handler: contest.getContestDetail,
  });

  fastify.post('/contests/:contestId/force-close', {
    schema: {
      tags: ['Admin'],
      summary: 'Force-close a contest',
      description: 'Force-closes a contest through the root-admin operations surface.',
      operationId: 'adminForceCloseContest',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.forceCloseContest,
  });

  fastify.post('/contests/:contestId/reopen', {
    schema: {
      tags: ['Admin'],
      summary: 'Reopen a closed contest',
      description: 'Reopens a contest through the root-admin operations surface.',
      operationId: 'adminReopenContest',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.reopenContest,
  });

  fastify.post('/contests/:contestId/override-score', {
    schema: {
      tags: ['Admin'],
      summary: 'Override an entry score in a contest',
      description: 'Applies a root-admin score override inside the specified contest.',
      operationId: 'adminOverrideScore',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
      body: {
        type: 'object',
        required: ['entryId', 'newScore', 'reason'],
        properties: {
          entryId: { type: 'string', minLength: 1 },
          newScore: { type: 'number' },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: contest.overrideScore,
  });

  fastify.post('/contests/:contestId/recalculate-standings', {
    schema: {
      tags: ['Admin'],
      summary: 'Recalculate contest standings',
      description: 'Triggers an administrative standings recalculation for the target contest.',
      operationId: 'adminRecalculateStandings',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ContestRecalculationResultDtoSchema) }, [404]),
    },
    handler: contest.recalculateStandings,
  });

  fastify.post('/contests/:contestId/recalculate-payouts', {
    schema: {
      tags: ['Admin'],
      summary: 'Recalculate contest payouts',
      description: 'Triggers an administrative payout recalculation for the target contest.',
      operationId: 'adminRecalculatePayouts',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
    },
    handler: contest.recalculatePayouts,
  });

  fastify.post('/contests/:contestId/re-ingest', {
    schema: {
      tags: ['Admin'],
      summary: 'Re-ingest scoring data for an event',
      description: 'Triggers administrative re-ingestion of scoring data for the target contest event.',
      operationId: 'adminReIngestScoring',
      response: withAdminErrorResponses({ 200: zodToJsonSchema(ContestRecalculationResultDtoSchema) }, [404]),
      body: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: contest.reIngestScoring,
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
      response: withAdminErrorResponses({ 200: zodToJsonSchema(SuccessSchema) }, [404]),
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
