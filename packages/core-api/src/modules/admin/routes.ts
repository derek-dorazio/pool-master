/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
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
import { MigrationService } from './migration-service';
import { createMigrationHandlers } from './migration-handler';
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
  MigrationListResponseSchema,
  MigrationRunResponseSchema,
  StartMigrationRunRequestSchema,
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

// ---------------------------------------------------------------------------
// Admin auth preHandler (placeholder — will be replaced with real SSO check)
// ---------------------------------------------------------------------------

async function adminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const adminUserId = request.headers['x-admin-user-id'] as string | undefined;
  if (!adminUserId) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Admin authentication required',
    });
  }
  // TODO: Verify admin JWT / SSO session and load admin user + permissions
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------

export async function adminModule(fastify: FastifyInstance): Promise<void> {
  // Apply admin auth to every route in this module
  fastify.addHook('preHandler', adminAuth);

  // --- Shared Prisma client for all admin services ---
  const prisma = new PrismaClient();

  // Initialise the audit service's Prisma reference so that the module-level
  // logAdminAction() helper can persist audit entries to the database.
  setAuditPrisma(prisma);
  setAuditQueryPrisma(prisma);

  // --- Services ---
  const userService = new UserService(prisma);
  const contestService = new ContestService(prisma);
  const healthService = new HealthService(prisma);
  const providerService = new ProviderService(prisma);
  const migrationService = new MigrationService(prisma);
  const pollConfigService = new PollConfigService();
  const ingestionConfigService = new IngestionConfigService();

  // --- Handlers ---
  const user = createUserHandlers(userService);
  const contest = createContestHandlers(contestService);
  const health = createHealthHandlers(healthService);
  const provider = createProviderHandlers(providerService);
  const migration = createMigrationHandlers(migrationService);

  // --- User Management Routes ---
  // NOTE: /users/merge is registered before /users/:userId to avoid route collision.

  fastify.get('/users', {
    schema: {
      tags: ['Admin'],
      summary: 'List users with filters',
      operationId: 'adminListUsers',
      response: { 200: zodToJsonSchema(UserListResponseSchema) },
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          tenant: { type: 'string' },
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
      operationId: 'adminMergeUsers',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminGetUserDetail',
      response: { 200: zodToJsonSchema(UserDetailResponseSchema) },
    },
    handler: user.getUserDetail,
  });

  fastify.post('/users/:userId/force-logout', {
    schema: {
      tags: ['Admin'],
      summary: 'Force logout a user from all sessions',
      operationId: 'adminForceLogout',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: user.forceLogout,
  });

  fastify.post('/users/:userId/disable', {
    schema: {
      tags: ['Admin'],
      summary: 'Disable a user account',
      operationId: 'adminDisableUser',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminEnableUser',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: user.enableUser,
  });

  // --- Contest Management Routes ---

  fastify.get('/contests', {
    schema: {
      tags: ['Admin'],
      summary: 'List contests with filters',
      operationId: 'adminListContests',
      response: { 200: zodToJsonSchema(AdminContestListResponseSchema) },
      querystring: {
        type: 'object',
        properties: {
          tenant: { type: 'string' },
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
      operationId: 'adminGetContestDetail',
      response: { 200: zodToJsonSchema(ContestAdminDetailResponseSchema) },
    },
    handler: contest.getContestDetail,
  });

  fastify.post('/contests/:contestId/force-close', {
    schema: {
      tags: ['Admin'],
      summary: 'Force-close a contest',
      operationId: 'adminForceCloseContest',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminReopenContest',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminOverrideScore',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminRecalculateStandings',
      response: { 200: zodToJsonSchema(ContestRecalculationResultDtoSchema) },
    },
    handler: contest.recalculateStandings,
  });

  fastify.post('/contests/:contestId/recalculate-payouts', {
    schema: {
      tags: ['Admin'],
      summary: 'Recalculate contest payouts',
      operationId: 'adminRecalculatePayouts',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: contest.recalculatePayouts,
  });

  fastify.post('/contests/:contestId/re-ingest', {
    schema: {
      tags: ['Admin'],
      summary: 'Re-ingest scoring data for an event',
      operationId: 'adminReIngestScoring',
      response: { 200: zodToJsonSchema(ContestRecalculationResultDtoSchema) },
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
      operationId: 'adminListProviders',
      response: { 200: zodToJsonSchema(ProviderListResponseSchema) },
    },
    handler: provider.listProviders,
  });

  fastify.get('/providers/ingestion', {
    schema: {
      tags: ['Admin'],
      summary: 'Get ingestion dashboard metrics',
      operationId: 'adminGetIngestionDashboard',
      response: { 200: zodToJsonSchema(ProviderIngestionDashboardResponseSchema) },
    },
    handler: provider.getIngestionDashboard,
  });

  fastify.get('/providers/unmapped-participants', {
    schema: {
      tags: ['Admin'],
      summary: 'List unmapped participants from providers',
      operationId: 'adminGetUnmappedParticipants',
      response: { 200: zodToJsonSchema(ProviderUnmappedParticipantListResponseSchema) },
    },
    handler: provider.getUnmappedParticipants,
  });

  fastify.post('/providers/map-participant', {
    schema: {
      tags: ['Admin'],
      summary: 'Map an external participant to an internal ID',
      operationId: 'adminMapParticipant',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminGetProviderDetail',
      response: { 200: zodToJsonSchema(ProviderDetailResponseSchema) },
    },
    handler: provider.getProviderDetail,
  });

  fastify.put('/providers/:providerId/config', {
    schema: {
      tags: ['Admin'],
      summary: 'Update provider configuration',
      operationId: 'adminUpdateProviderConfig',
      response: { 200: zodToJsonSchema(SuccessSchema) },
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
      operationId: 'adminTriggerHealthCheck',
      response: { 200: zodToJsonSchema(ProviderHealthCheckDtoSchema) },
    },
    handler: provider.triggerHealthCheck,
  });

  fastify.post('/providers/:providerId/re-ingest/:eventId', {
    schema: {
      tags: ['Admin'],
      summary: 'Re-ingest event data from a provider',
      operationId: 'adminReIngestEvent',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: provider.reIngestEvent,
  });

  // --- Health / Platform Monitoring Routes ---
  // Permission: platform.health

  fastify.get('/health/services', {
    schema: {
      tags: ['Admin'],
      summary: 'Get service health status',
      operationId: 'adminGetServiceHealth',
      response: { 200: zodToJsonSchema(ServiceHealthListResponseSchema) },
    },
    handler: health.getServiceHealth,
  });

  fastify.get('/health/infrastructure', {
    schema: {
      tags: ['Admin'],
      summary: 'Get infrastructure metrics',
      operationId: 'adminGetInfrastructureMetrics',
      response: { 200: zodToJsonSchema(InfrastructureMetricsResponseSchema) },
    },
    handler: health.getInfrastructureMetrics,
  });

  fastify.get('/health/metrics', {
    schema: {
      tags: ['Admin'],
      summary: 'Get business metrics',
      operationId: 'adminGetBusinessMetrics',
      response: { 200: zodToJsonSchema(BusinessMetricsResponseSchema) },
    },
    handler: health.getBusinessMetrics,
  });

  fastify.get('/health/errors', {
    schema: {
      tags: ['Admin'],
      summary: 'Search platform errors',
      operationId: 'adminSearchErrors',
      response: { 200: zodToJsonSchema(ErrorLogListResponseSchema) },
      querystring: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          severity: { type: 'string', enum: ['ERROR', 'CRITICAL', 'WARNING'] },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          tenant: { type: 'string' },
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
      operationId: 'adminGetErrorDetail',
      response: { 200: zodToJsonSchema(ErrorLogDetailResponseSchema) },
    },
    handler: health.getErrorDetail,
  });

  fastify.get('/health/alerts', {
    schema: {
      tags: ['Admin'],
      summary: 'Get alert rules',
      operationId: 'adminGetAlertRules',
      response: { 200: zodToJsonSchema(AlertRulesResponseSchema) },
    },
    handler: health.getAlertRules,
  });

  fastify.put('/health/alerts/:alertId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update an alert rule',
      operationId: 'adminUpdateAlertRule',
      response: { 200: zodToJsonSchema(AlertRuleDtoSchema) },
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
      operationId: 'adminMuteAlert',
      response: { 200: zodToJsonSchema(AlertRuleDtoSchema) },
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
      operationId: 'adminUnmuteAlert',
      response: { 200: zodToJsonSchema(AlertRuleDtoSchema) },
    },
    handler: health.unmuteAlert,
  });

  // --- Migration Routes ---
  // Permission: platform.migrations

  fastify.get('/migrations', {
    schema: {
      tags: ['Admin'],
      summary: 'List available data migrations',
      operationId: 'adminListMigrations',
      response: { 200: zodToJsonSchema(MigrationListResponseSchema) },
    },
    handler: migration.listMigrations,
  });

  fastify.post('/migrations/run', {
    schema: {
      tags: ['Admin'],
      summary: 'Start a data migration run',
      operationId: 'adminStartMigrationRun',
      response: { 201: zodToJsonSchema(MigrationRunResponseSchema) },
      body: zodToJsonSchema(StartMigrationRunRequestSchema),
    },
    handler: migration.startRun,
  });

  fastify.get('/migrations/runs/:runId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get migration run detail',
      operationId: 'adminGetMigrationRunDetail',
      response: { 200: zodToJsonSchema(MigrationRunResponseSchema) },
    },
    handler: migration.getRunDetail,
  });

  fastify.post('/migrations/runs/:runId/cancel', {
    schema: {
      tags: ['Admin'],
      summary: 'Cancel a migration run',
      operationId: 'adminCancelMigrationRun',
      response: { 200: zodToJsonSchema(MigrationRunResponseSchema) },
    },
    handler: migration.cancelRun,
  });

  // --- Platform Configuration Routes ---
  // Permission: platform.config

  await fastify.register(auditRoutes);

  registerPlatformConfigRoutes(fastify, {
    pollConfig: pollConfigService,
    ingestionConfig: ingestionConfigService,
  });
}
