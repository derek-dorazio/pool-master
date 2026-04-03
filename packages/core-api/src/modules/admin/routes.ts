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
import { TenantService } from './tenant-service';
import { createTenantHandlers } from './tenant-handler';
import { UserService } from './user-service';
import { createUserHandlers } from './user-handler';
import { ContestService } from './contest-service';
import { createContestHandlers } from './contest-handler';
import { HealthService } from './health-service';
import { createHealthHandlers } from './health-handler';
import { ProviderService } from './provider-service';
import { createProviderHandlers } from './provider-handler';
import { FlagService } from './flag-service';
import { createFlagHandlers } from './flag-handler';
import { ImpersonationService } from './impersonation-service';
import { createImpersonationHandlers } from './impersonation-handler';
import { AnnouncementService } from './announcement-service';
import { createAnnouncementHandlers } from './announcement-handler';
import { MigrationService } from './migration-service';
import { createMigrationHandlers } from './migration-handler';
import { SupportService } from './support-service';
import { createSupportHandlers } from './support-handler';
import { createQuickActionsHandlers } from './quick-actions-handler';
import { EntitlementService } from '../billing/entitlement-service';
import { UsageService } from '../billing/usage-service';
import { ExportService } from './export-service';
import { createExportHandlers } from './export-handler';
import { PollConfigService } from './poll-config-service';
import { IngestionConfigService } from './ingestion-config-service';
import { DunningConfigService } from './dunning-config-service';
import { ChannelConfigService } from './channel-config-service';
import { RetentionConfigService } from './retention-config-service';
import { DigestConfigService } from './digest-config-service';
import { registerPlatformConfigRoutes } from './platform-config-routes';
import { configRoutes } from './config-routes';
import { auditRoutes } from './audit-routes';

const commonDtoModule = require('../../../../shared/dto/common.dto.ts') as typeof import('../../../../shared/dto/common.dto');
const adminDtoModule = require('../../../../shared/dto/admin.dto.ts') as typeof import('../../../../shared/dto/admin.dto');
const jsonSchemaModule = require('../../../../shared/dto/json-schema.ts') as typeof import('../../../../shared/dto/json-schema');

const { SuccessSchema } = commonDtoModule;
const {
  TenantListResponseSchema,
  TenantDetailResponseSchema,
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
  SupportInvestigationResponseSchema,
  SupportErrorListResponseSchema,
  SupportNotificationFailureListResponseSchema,
  SupportActivityListResponseSchema,
  QuickResetPasswordResponseSchema,
  QuickProviderCheckResponseSchema,
  QuickEntitlementsResponseSchema,
  QuickNotificationsResponseSchema,
  QuickReIngestScoresResponseSchema,
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
} = adminDtoModule;
const { zodToJsonSchema } = jsonSchemaModule;

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
  const tenantService = new TenantService(prisma);
  const userService = new UserService(prisma);
  const contestService = new ContestService(prisma);
  const healthService = new HealthService(prisma);
  const providerService = new ProviderService(prisma);
  const flagService = new FlagService(prisma);
  const impersonationService = new ImpersonationService(prisma);
  const announcementService = new AnnouncementService(prisma);
  const migrationService = new MigrationService(prisma);
  const usageService = new UsageService(prisma);
  const entitlementService = new EntitlementService(prisma, usageService);
  const supportService = new SupportService(prisma);
  const exportService = new ExportService(prisma);
  const pollConfigService = new PollConfigService();
  const ingestionConfigService = new IngestionConfigService();
  const dunningConfigService = new DunningConfigService();
  const channelConfigService = new ChannelConfigService();
  const retentionConfigService = new RetentionConfigService();
  const digestConfigService = new DigestConfigService();

  // --- Handlers ---
  const tenant = createTenantHandlers(tenantService);
  const user = createUserHandlers(userService);
  const contest = createContestHandlers(contestService);
  const health = createHealthHandlers(healthService);
  const provider = createProviderHandlers(providerService);
  const flag = createFlagHandlers(flagService);
  const impersonation = createImpersonationHandlers(impersonationService);
  const announcement = createAnnouncementHandlers(announcementService);
  const migration = createMigrationHandlers(migrationService);
  const support = createSupportHandlers(supportService);
  const quickActions = createQuickActionsHandlers({
    prisma,
    userService,
    providerService,
    contestService,
    entitlementService,
  });
  const tenantExport = createExportHandlers(exportService);

  // --- Tenant Management Routes ---

  fastify.get('/tenants', {
    schema: {
      tags: ['Admin'],
      summary: 'List all tenants with filters',
      operationId: 'adminListTenants',
      response: { 200: zodToJsonSchema(TenantListResponseSchema) },
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          planTier: { type: 'string' },
          status: { type: 'string', enum: ['active', 'suspended', 'trial'] },
          sortBy: { type: 'string', enum: ['name', 'created', 'members', 'lastActive'] },
          sortDir: { type: 'string', enum: ['asc', 'desc'] },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: tenant.listTenants,
  });

  fastify.get('/tenants/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get tenant detail',
      operationId: 'adminGetTenantDetail',
      response: { 200: zodToJsonSchema(TenantDetailResponseSchema) },
    },
    handler: tenant.getTenantDetail,
  });

  fastify.put('/tenants/:tenantId/plan', {
    schema: {
      tags: ['Admin'],
      summary: 'Change tenant plan tier',
      operationId: 'adminChangeTenantPlan',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['planTier', 'reason'],
        properties: {
          planTier: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.changePlan,
  });

  fastify.post('/tenants/:tenantId/suspend', {
    schema: {
      tags: ['Admin'],
      summary: 'Suspend a tenant',
      operationId: 'adminSuspendTenant',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.suspendTenant,
  });

  fastify.post('/tenants/:tenantId/unsuspend', {
    schema: {
      tags: ['Admin'],
      summary: 'Unsuspend a tenant',
      operationId: 'adminUnsuspendTenant',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: tenant.unsuspendTenant,
  });

  fastify.post('/tenants/:tenantId/credit', {
    schema: {
      tags: ['Admin'],
      summary: 'Apply credit to a tenant account',
      operationId: 'adminApplyCredit',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['amount', 'reason'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.applyCredit,
  });

  fastify.post('/tenants/:tenantId/extend-trial', {
    schema: {
      tags: ['Admin'],
      summary: 'Extend tenant trial period',
      operationId: 'adminExtendTrial',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['days', 'reason'],
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365 },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    handler: tenant.extendTrial,
  });

  fastify.delete('/tenants/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a tenant permanently',
      operationId: 'adminDeleteTenant',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['confirmation'],
        properties: {
          confirmation: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: tenant.deleteTenant,
  });

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

  fastify.post('/users/:userId/reset-password', {
    schema: {
      tags: ['Admin'],
      summary: 'Reset user password',
      operationId: 'adminResetPassword',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: user.resetPassword,
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

  fastify.post('/users/:userId/email', {
    schema: {
      tags: ['Admin'],
      summary: 'Send administrative email to user',
      operationId: 'adminSendEmail',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['subject', 'body'],
        properties: {
          subject: { type: 'string', minLength: 1, maxLength: 500 },
          body: { type: 'string', minLength: 1, maxLength: 10000 },
        },
      },
    },
    handler: user.sendAdminEmail,
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

  // --- Feature Flag Routes ---
  // Permission: flags.view, flags.edit

  fastify.get('/flags', {
    schema: {
      tags: ['Admin'],
      summary: 'List all feature flags',
      operationId: 'adminListFlags',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: flag.listFlags,
  });

  fastify.post('/flags', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a new feature flag',
      operationId: 'adminCreateFlag',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['key', 'name', 'description', 'flagType', 'enabledGlobally', 'owner'],
        properties: {
          key: { type: 'string', minLength: 1, pattern: '^[a-z][a-z0-9_]*$' },
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          flagType: { type: 'string', enum: ['BOOLEAN', 'PERCENTAGE', 'TENANT_LIST'] },
          enabledGlobally: { type: 'boolean' },
          rolloutPercentage: { type: 'integer', minimum: 0, maximum: 100 },
          owner: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: flag.createFlag,
  });

  fastify.get('/flags/:flagKey', {
    schema: {
      tags: ['Admin'],
      summary: 'Get feature flag detail',
      operationId: 'adminGetFlagDetail',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: flag.getFlagDetail,
  });

  fastify.put('/flags/:flagKey', {
    schema: {
      tags: ['Admin'],
      summary: 'Update a feature flag',
      operationId: 'adminUpdateFlag',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          enabledGlobally: { type: 'boolean' },
          rolloutPercentage: { type: 'integer', minimum: 0, maximum: 100 },
          owner: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: flag.updateFlag,
  });

  fastify.delete('/flags/:flagKey', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete a feature flag',
      operationId: 'adminDeleteFlag',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: flag.deleteFlag,
  });

  fastify.post('/flags/:flagKey/overrides', {
    schema: {
      tags: ['Admin'],
      summary: 'Add a tenant override for a feature flag',
      operationId: 'adminAddFlagOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['tenantId', 'tenantName', 'enabled', 'reason'],
        properties: {
          tenantId: { type: 'string', minLength: 1 },
          tenantName: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    handler: flag.addOverride,
  });

  fastify.delete('/flags/:flagKey/overrides/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Remove a tenant override for a feature flag',
      operationId: 'adminRemoveFlagOverride',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: flag.removeOverride,
  });

  fastify.get('/flags/:flagKey/resolve/:tenantId', {
    schema: {
      tags: ['Admin'],
      summary: 'Resolve feature flag value for a tenant',
      operationId: 'adminResolveFlag',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: flag.resolveFlag,
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

  // --- Impersonation Routes ---
  // Permission: tenant.impersonate

  fastify.post('/impersonation/start', {
    schema: {
      tags: ['Admin'],
      summary: 'Start tenant impersonation session',
      operationId: 'adminStartImpersonation',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['tenantId'],
        properties: {
          tenantId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: impersonation.startSession,
  });

  fastify.post('/impersonation/end', {
    schema: {
      tags: ['Admin'],
      summary: 'End tenant impersonation session',
      operationId: 'adminEndImpersonation',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: impersonation.endSession,
  });

  fastify.get('/impersonation/active', {
    schema: {
      tags: ['Admin'],
      summary: 'Get active impersonation session',
      operationId: 'adminGetActiveImpersonation',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: impersonation.getActiveSession,
  });

  // --- Announcement Routes ---
  // Permission: platform.announcements

  fastify.get('/announcements/active', {
    schema: {
      tags: ['Admin'],
      summary: 'Get active announcements',
      operationId: 'adminGetActiveAnnouncements',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.getActiveAnnouncements,
  });

  fastify.get('/announcements', {
    schema: {
      tags: ['Admin'],
      summary: 'List all announcements',
      operationId: 'adminListAnnouncements',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.listAnnouncements,
  });

  fastify.post('/announcements', {
    schema: {
      tags: ['Admin'],
      summary: 'Create a new announcement',
      operationId: 'adminCreateAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        required: ['type', 'title', 'body', 'severity'],
        properties: {
          type: { type: 'string', enum: ['BANNER', 'NOTIFICATION', 'BOTH'] },
          title: { type: 'string', minLength: 1, maxLength: 255 },
          body: { type: 'string', minLength: 1 },
          linkUrl: { type: 'string' },
          linkText: { type: 'string' },
          severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
          dismissable: { type: 'boolean' },
          target: { type: 'string', enum: ['ALL_USERS', 'ALL_TENANTS', 'SPECIFIC_TENANTS'] },
          targetTenantIds: { type: 'array', items: { type: 'string' } },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: announcement.createAnnouncement,
  });

  fastify.get('/announcements/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Get announcement by ID',
      operationId: 'adminGetAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.getAnnouncement,
  });

  fastify.put('/announcements/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Update an announcement',
      operationId: 'adminUpdateAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 255 },
          body: { type: 'string', minLength: 1 },
          linkUrl: { type: 'string' },
          linkText: { type: 'string' },
          severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
          dismissable: { type: 'boolean' },
          target: { type: 'string', enum: ['ALL_USERS', 'ALL_TENANTS', 'SPECIFIC_TENANTS'] },
          targetTenantIds: { type: 'array', items: { type: 'string' } },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: announcement.updateAnnouncement,
  });

  fastify.delete('/announcements/:id', {
    schema: {
      tags: ['Admin'],
      summary: 'Delete an announcement',
      operationId: 'adminDeleteAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.deleteAnnouncement,
  });

  fastify.post('/announcements/:id/activate', {
    schema: {
      tags: ['Admin'],
      summary: 'Activate an announcement',
      operationId: 'adminActivateAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.activateAnnouncement,
  });

  fastify.post('/announcements/:id/deactivate', {
    schema: {
      tags: ['Admin'],
      summary: 'Deactivate an announcement',
      operationId: 'adminDeactivateAnnouncement',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: announcement.deactivateAnnouncement,
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

  // --- Support Investigation Routes ---
  // Permission: tenant.view (support staff need at minimum view access)

  fastify.get('/support/tenant/:tenantId/investigation', {
    schema: {
      tags: ['Admin'],
      summary: 'Get support investigation overview for a tenant',
      operationId: 'adminGetInvestigation',
      response: { 200: zodToJsonSchema(SupportInvestigationResponseSchema) },
    },
    handler: support.getInvestigation,
  });

  fastify.get('/support/tenant/:tenantId/errors', {
    schema: {
      tags: ['Admin'],
      summary: 'Get recent errors for a tenant',
      operationId: 'adminGetTenantErrors',
      response: { 200: zodToJsonSchema(SupportErrorListResponseSchema) },
    },
    handler: support.getErrors,
  });

  fastify.get('/support/tenant/:tenantId/notifications', {
    schema: {
      tags: ['Admin'],
      summary: 'Get recent notifications for a tenant',
      operationId: 'adminGetTenantNotifications',
      response: { 200: zodToJsonSchema(SupportNotificationFailureListResponseSchema) },
    },
    handler: support.getNotifications,
  });

  fastify.get('/support/tenant/:tenantId/requests', {
    schema: {
      tags: ['Admin'],
      summary: 'Get recent support activity for a tenant',
      operationId: 'adminGetTenantRequests',
      response: { 200: zodToJsonSchema(SupportActivityListResponseSchema) },
    },
    handler: support.getRequests,
  });

  // --- Quick Action Routes ---
  // Permission: varies by action (user.edit, sportsdata.re_ingest, etc.)

  fastify.post('/support/quick-actions/reset-password', {
    schema: {
      tags: ['Admin'],
      summary: 'Quick action: reset user password',
      operationId: 'adminQuickResetPassword',
      response: { 200: zodToJsonSchema(QuickResetPasswordResponseSchema) },
      body: {
        type: 'object',
        required: ['userId', 'email'],
        properties: {
          userId: { type: 'string', minLength: 1 },
          email: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: quickActions.resetPassword,
  });

  fastify.post('/support/quick-actions/check-provider', {
    schema: {
      tags: ['Admin'],
      summary: 'Quick action: check sports data provider',
      operationId: 'adminQuickCheckProvider',
      response: { 200: zodToJsonSchema(QuickProviderCheckResponseSchema) },
      body: {
        type: 'object',
        required: ['providerId', 'sport'],
        properties: {
          providerId: { type: 'string', minLength: 1 },
          sport: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: quickActions.checkProvider,
  });

  fastify.post('/support/quick-actions/check-entitlements', {
    schema: {
      tags: ['Admin'],
      summary: 'Quick action: check tenant entitlements',
      operationId: 'adminQuickCheckEntitlements',
      response: { 200: zodToJsonSchema(QuickEntitlementsResponseSchema) },
      body: {
        type: 'object',
        required: ['tenantId'],
        properties: {
          tenantId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: quickActions.checkEntitlements,
  });

  fastify.post('/support/quick-actions/check-notifications', {
    schema: {
      tags: ['Admin'],
      summary: 'Quick action: check user notifications',
      operationId: 'adminQuickCheckNotifications',
      response: { 200: zodToJsonSchema(QuickNotificationsResponseSchema) },
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: quickActions.checkNotifications,
  });

  fastify.post('/support/quick-actions/re-ingest-scores', {
    schema: {
      tags: ['Admin'],
      summary: 'Quick action: re-ingest scoring data',
      operationId: 'adminQuickReIngestScores',
      response: { 200: zodToJsonSchema(QuickReIngestScoresResponseSchema) },
      body: {
        type: 'object',
        required: ['contestId', 'eventId'],
        properties: {
          contestId: { type: 'string', minLength: 1 },
          eventId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: quickActions.reIngestScores,
  });

  // --- Tenant Data Export Routes ---
  // Permission: tenant.view

  fastify.post('/tenants/:tenantId/export', {
    schema: {
      tags: ['Admin'],
      summary: 'Start tenant data export',
      operationId: 'adminStartTenantExport',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: tenantExport.startExport,
  });

  fastify.get('/tenants/:tenantId/export/status', {
    schema: {
      tags: ['Admin'],
      summary: 'Get tenant export status',
      operationId: 'adminGetExportStatus',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: tenantExport.getExportStatus,
  });

  fastify.get('/tenants/:tenantId/export/download', {
    schema: {
      tags: ['Admin'],
      summary: 'Download tenant export',
      operationId: 'adminDownloadExport',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: tenantExport.downloadExport,
  });

  // --- Platform Configuration Routes ---
  // Permission: platform.config

  await fastify.register(auditRoutes);

  registerPlatformConfigRoutes(fastify, {
    pollConfig: pollConfigService,
    ingestionConfig: ingestionConfigService,
    dunningConfig: dunningConfigService,
    channelConfig: channelConfigService,
    retentionConfig: retentionConfigService,
    digestConfig: digestConfigService,
  });

  // --- Admin Config Routes (templates, push triggers, rate limits) ---
  // Permission: config.*

  await fastify.register(configRoutes);
}
