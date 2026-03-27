/**
 * Admin module — registers all admin-scoped routes for platform operations.
 *
 * All routes require admin authentication via the adminAuth preHandler hook.
 * Mounted at /api/v1/admin by the application root.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { ExportService } from './export-service';
import { createExportHandlers } from './export-handler';

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

  // --- Services ---
  const tenantService = new TenantService();
  const userService = new UserService();
  const contestService = new ContestService();
  const healthService = new HealthService();
  const providerService = new ProviderService();
  const flagService = new FlagService();
  const impersonationService = new ImpersonationService();
  const announcementService = new AnnouncementService();
  const migrationService = new MigrationService();
  const supportService = new SupportService();
  const exportService = new ExportService();

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
  const quickActions = createQuickActionsHandlers();
  const tenantExport = createExportHandlers(exportService);

  // --- Tenant Management Routes ---

  fastify.get('/tenants', {
    schema: {
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

  fastify.get('/tenants/:tenantId', tenant.getTenantDetail);

  fastify.put('/tenants/:tenantId/plan', {
    schema: {
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

  fastify.post('/tenants/:tenantId/unsuspend', tenant.unsuspendTenant);

  fastify.post('/tenants/:tenantId/credit', {
    schema: {
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

  fastify.get('/users/:userId', user.getUserDetail);

  fastify.post('/users/:userId/reset-password', user.resetPassword);

  fastify.post('/users/:userId/force-logout', user.forceLogout);

  fastify.post('/users/:userId/disable', {
    schema: {
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

  fastify.post('/users/:userId/enable', user.enableUser);

  fastify.post('/users/:userId/email', {
    schema: {
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

  fastify.get('/contests/:contestId', contest.getContestDetail);

  fastify.post('/contests/:contestId/force-close', {
    schema: {
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

  fastify.post('/contests/:contestId/recalculate-standings', contest.recalculateStandings);

  fastify.post('/contests/:contestId/recalculate-payouts', contest.recalculatePayouts);

  fastify.post('/contests/:contestId/re-ingest', {
    schema: {
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

  fastify.get('/providers/health', provider.listProviders);

  fastify.get('/providers/ingestion', provider.getIngestionDashboard);

  fastify.get('/providers/unmapped-participants', provider.getUnmappedParticipants);

  fastify.post('/providers/map-participant', {
    schema: {
      body: {
        type: 'object',
        required: ['externalId', 'internalId'],
        properties: {
          externalId: { type: 'string', minLength: 1 },
          internalId: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: provider.mapParticipant,
  });

  fastify.get('/providers/:providerId', provider.getProviderDetail);

  fastify.put('/providers/:providerId/config', {
    schema: {
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

  fastify.post('/providers/:providerId/health-check', provider.triggerHealthCheck);

  fastify.post('/providers/:providerId/re-ingest/:eventId', provider.reIngestEvent);

  // --- Feature Flag Routes ---
  // Permission: flags.view, flags.edit

  fastify.get('/flags', flag.listFlags);

  fastify.post('/flags', {
    schema: {
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

  fastify.get('/flags/:flagKey', flag.getFlagDetail);

  fastify.put('/flags/:flagKey', {
    schema: {
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

  fastify.delete('/flags/:flagKey', flag.deleteFlag);

  fastify.post('/flags/:flagKey/overrides', {
    schema: {
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

  fastify.delete('/flags/:flagKey/overrides/:tenantId', flag.removeOverride);

  fastify.get('/flags/:flagKey/resolve/:tenantId', flag.resolveFlag);

  // --- Health / Platform Monitoring Routes ---
  // Permission: platform.health

  fastify.get('/health/services', health.getServiceHealth);

  fastify.get('/health/infrastructure', health.getInfrastructureMetrics);

  fastify.get('/health/metrics', health.getBusinessMetrics);

  fastify.get('/health/errors', {
    schema: {
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

  fastify.get('/health/errors/:errorId', health.getErrorDetail);

  fastify.get('/health/alerts', health.getAlertRules);

  fastify.put('/health/alerts/:alertId', {
    schema: {
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

  fastify.post('/health/alerts/:alertId/unmute', health.unmuteAlert);

  // --- Impersonation Routes ---
  // Permission: tenant.impersonate

  fastify.post('/impersonation/start', {
    schema: {
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

  fastify.post('/impersonation/end', impersonation.endSession);

  fastify.get('/impersonation/active', impersonation.getActiveSession);

  // --- Announcement Routes ---
  // Permission: platform.announcements

  fastify.get('/announcements/active', announcement.getActiveAnnouncements);

  fastify.get('/announcements', announcement.listAnnouncements);

  fastify.post('/announcements', {
    schema: {
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

  fastify.get('/announcements/:id', announcement.getAnnouncement);

  fastify.put('/announcements/:id', {
    schema: {
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

  fastify.delete('/announcements/:id', announcement.deleteAnnouncement);

  fastify.post('/announcements/:id/activate', announcement.activateAnnouncement);

  fastify.post('/announcements/:id/deactivate', announcement.deactivateAnnouncement);

  // --- Migration Routes ---
  // Permission: platform.migrations

  fastify.get('/migrations', migration.listMigrations);

  fastify.post('/migrations/run', {
    schema: {
      body: {
        type: 'object',
        required: ['migrationId'],
        properties: {
          migrationId: { type: 'string', minLength: 1 },
          dryRun: { type: 'boolean' },
          batchSize: { type: 'integer', minimum: 1 },
          tenantIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    handler: migration.startRun,
  });

  fastify.get('/migrations/runs/:runId', migration.getRunDetail);

  fastify.post('/migrations/runs/:runId/cancel', migration.cancelRun);

  // --- Support Investigation Routes ---
  // Permission: tenant.view (support staff need at minimum view access)

  fastify.get('/support/tenant/:tenantId/investigation', support.getInvestigation);

  fastify.get('/support/tenant/:tenantId/errors', support.getErrors);

  fastify.get('/support/tenant/:tenantId/notifications', support.getNotifications);

  fastify.get('/support/tenant/:tenantId/requests', support.getRequests);

  // --- Quick Action Routes ---
  // Permission: varies by action (user.edit, sportsdata.re_ingest, etc.)

  fastify.post('/support/quick-actions/reset-password', {
    schema: {
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

  fastify.post('/tenants/:tenantId/export', tenantExport.startExport);

  fastify.get('/tenants/:tenantId/export/status', tenantExport.getExportStatus);

  fastify.get('/tenants/:tenantId/export/download', tenantExport.downloadExport);
}
