/**
 * Integration test helpers — provides a configured Fastify app with real Prisma + Postgres.
 *
 * Usage:
 *   import { getApp, getPrisma, createTestUser, authenticatedHeaders } from '../helpers';
 *
 *   const app = getApp();
 *   const prisma = getPrisma();
 *
 *   const { user, headers } = await createTestUser();
 *   const res = await app.inject({ method: 'GET', url: '/api/v1/leagues', headers });
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

// Plugins and modules from core-api
import { healthPlugin } from '../../packages/core-api/src/plugins/health';
import { authGuard } from '../../packages/core-api/src/plugins/auth-guard';
import { tenantPlugin } from '../../packages/core-api/src/core/tenant-context';
import { authModule } from '../../packages/core-api/src/modules/auth/routes';
import { leaguesModule } from '../../packages/core-api/src/modules/leagues/routes';
import { invitationsModule } from '../../packages/core-api/src/modules/invitations/routes';
import { contestsModule, contestsByIdModule } from '../../packages/core-api/src/modules/contests/routes';
import { participantsModule } from '../../packages/core-api/src/modules/participants/routes';
import { standingsModule } from '../../packages/core-api/src/modules/standings/routes';
import { searchModule } from '../../packages/core-api/src/modules/search/routes';
import { complianceModule } from '../../packages/core-api/src/modules/compliance/routes';
import { configModule } from '../../packages/core-api/src/modules/config/routes';
import { draftsModule } from '../../packages/core-api/src/modules/drafts/routes';
import { templatesModule } from '../../packages/core-api/src/modules/templates/routes';
import { contestPoolModule } from '../../packages/core-api/src/modules/participants/pool-routes';
import { adminModule } from '../../packages/core-api/src/modules/admin/routes';
import { historyModule } from '../../packages/core-api/src/modules/history/routes';
import { billingModule } from '../../packages/core-api/src/modules/billing/routes';
import { socialModule } from '../../packages/core-api/src/modules/social/routes';
import { notificationsModule } from '../../packages/core-api/src/modules/notifications/routes';
import { loadConfig as loadNotifConfig } from '../../packages/core-api/src/modules/notifications/core/config';
import { createChannels } from '../../packages/core-api/src/modules/notifications/channels/channel-factory';
import { NotificationDispatcher } from '../../packages/core-api/src/modules/notifications/core/dispatcher';
import { InMemoryRateLimiter } from '../../packages/core-api/src/modules/notifications/core/rate-limiter';
import { EventGrouper } from '../../packages/core-api/src/modules/notifications/core/event-grouper';
import { ScheduledRunner } from '../../packages/core-api/src/modules/notifications/core/scheduled-runner';
import { WeeklyDigestService } from '../../packages/core-api/src/modules/notifications/core/weekly-digest';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
const TEST_TENANT_ID = '00000000-0000-0000-0000-999999999999';

let app: FastifyInstance;
let prisma: PrismaClient;

/** Get the shared Fastify app instance (created once per test suite). */
export function getApp(): FastifyInstance {
  return app;
}

/** Get the shared Prisma client. */
export function getPrisma(): PrismaClient {
  return prisma;
}

/** Test tenant ID used across all integration tests. */
export function getTestTenantId(): string {
  return TEST_TENANT_ID;
}

/** Build the Fastify app with real plugins and modules (no background jobs). */
async function buildTestApp(): Promise<FastifyInstance> {
  const testApp = Fastify({ logger: false });

  // Core plugins
  testApp.register(healthPlugin);
  testApp.register(authGuard);
  testApp.register(tenantPlugin);

  // Route modules
  testApp.register(authModule, { prefix: '/api/v1/auth' });
  testApp.register(leaguesModule, { prefix: '/api/v1/leagues' });
  testApp.register(invitationsModule, { prefix: '/api/v1/invitations' });
  testApp.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
  testApp.register(contestsByIdModule, { prefix: '/api/v1/contests' });
  testApp.register(participantsModule, { prefix: '/api/v1/participants' });
  testApp.register(standingsModule, { prefix: '/api/v1/contests/:contestId/standings' });
  testApp.register(searchModule, { prefix: '/api/v1/search' });
  testApp.register(complianceModule, { prefix: '/api/v1/account' });
  testApp.register(configModule, { prefix: '/api/v1/config' });
  testApp.register(draftsModule, { prefix: '/api/v1/drafts' });
  testApp.register(templatesModule, { prefix: '/api/v1/templates' });
  testApp.register(contestPoolModule, { prefix: '/api/v1/contests/:contestId/pool' });
  testApp.register(adminModule, { prefix: '/api/v1/admin' });
  testApp.register(historyModule, { prefix: '/api/v1' });
  testApp.register(billingModule, { prefix: '/api/v1/billing' });
  testApp.register(socialModule, { prefix: '/api/v1' });

  // Notification module (for notification persistence tests)
  const notifConfig = loadNotifConfig();
  const notifChannels = createChannels(notifConfig, prisma);
  const rateLimiter = new InMemoryRateLimiter();
  const dispatcher = new NotificationDispatcher(prisma, notifChannels, rateLimiter);
  const eventGrouper = new EventGrouper();
  const scheduledRunner = new ScheduledRunner(prisma, dispatcher);
  const digestService = new WeeklyDigestService(prisma, notifChannels);

  testApp.register(notificationsModule, {
    prefix: '/api/v1',
    prisma, channels: notifChannels, dispatcher, rateLimiter,
    eventGrouper, scheduledRunner, digestService,
  });

  await testApp.ready();
  return testApp;
}

/** Create the test tenant if it doesn't exist. */
async function ensureTestTenant(): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: TEST_TENANT_ID },
    create: {
      id: TEST_TENANT_ID,
      name: 'Integration Test Tenant',
      slug: 'integration-test',
    },
    update: {},
  });
}

/** Set up the Fastify app and Prisma client. Called once before all tests. */
export async function setupIntegrationTests(): Promise<void> {
  prisma = new PrismaClient();
  await prisma.$connect();
  await ensureTestTenant();
  app = await buildTestApp();
}

/** Tear down after all tests. */
export async function teardownIntegrationTests(): Promise<void> {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

interface TestUserResult {
  user: { id: string; email: string; displayName: string; tenantId: string };
  headers: Record<string, string>;
  accessToken: string;
}

/**
 * Create a real user in Postgres and return a valid JWT for authenticated requests.
 */
export async function createTestUser(overrides: {
  email?: string;
  displayName?: string;
  password?: string;
} = {}): Promise<TestUserResult> {
  const id = randomUUID();
  const email = overrides.email ?? `test-${id.slice(0, 8)}@integration.test`;
  const displayName = overrides.displayName ?? `Test User ${id.slice(0, 8)}`;
  const passwordHash = await bcrypt.hash(overrides.password ?? 'TestPass123', 10);

  const user = await prisma.user.create({
    data: {
      id,
      email,
      displayName,
      passwordHash,
      tenantId: TEST_TENANT_ID,
    },
  });

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, tenantId: TEST_TENANT_ID },
    JWT_SECRET,
    { expiresIn: '15m' },
  );

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, tenantId: TEST_TENANT_ID },
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    accessToken,
  };
}

/**
 * Generate authenticated headers for an existing user (without creating in DB).
 */
export function authHeaders(userId: string, email: string): Record<string, string> {
  const accessToken = jwt.sign(
    { sub: userId, email, tenantId: TEST_TENANT_ID },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

/**
 * Clean up test data created during tests.
 * Deletes in reverse dependency order using raw SQL for reliability.
 */
export async function cleanupTestData(): Promise<void> {
  const tid = TEST_TENANT_ID;
  // Tables that reference contests
  const contestChildTables = [
    'contest_entries', 'contest_standings', 'contest_results', 'scoring_checkpoints',
    'draft_sessions', 'draft_picks', 'selection_configs', 'bracket_predictions',
    'contest_participant_pool', 'roster_picks', 'contest_picks', 'payout_history',
    'commissioner_audit_log', 'commissioner_action_items',
  ];
  // Tables that reference leagues
  const leagueChildTables = [
    'season_notes', 'league_season_summaries', 'league_records', 'rivalry_records',
    'trophies', 'team_roster_history', 'retention_configs', 'retention_job_runs',
    'discoverable_leagues',
  ];

  for (const table of contestChildTables) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE contest_id IN (SELECT id FROM contests WHERE league_id IN (SELECT id FROM leagues WHERE tenant_id = $1::uuid))`,
      tid,
    ).catch(() => {});
  }
  await prisma.$executeRawUnsafe(
    'DELETE FROM contests WHERE league_id IN (SELECT id FROM leagues WHERE tenant_id = $1::uuid)',
    tid,
  ).catch(() => {});

  for (const table of leagueChildTables) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE league_id IN (SELECT id FROM leagues WHERE tenant_id = $1::uuid)`,
      tid,
    ).catch(() => {});
  }
  await prisma.$executeRawUnsafe(
    'DELETE FROM league_invitations WHERE league_id IN (SELECT id FROM leagues WHERE tenant_id = $1::uuid)',
    tid,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    'DELETE FROM league_memberships WHERE league_id IN (SELECT id FROM leagues WHERE tenant_id = $1::uuid)',
    tid,
  ).catch(() => {});
  await prisma.$executeRawUnsafe('DELETE FROM leagues WHERE tenant_id = $1::uuid', tid).catch(() => {});

  // Participants created during tests (name starts with test pattern)
  await prisma.$executeRawUnsafe(`DELETE FROM participant_season_records WHERE participant_id IN (SELECT id FROM participants WHERE name LIKE 'Tiger%' OR name LIKE 'Eldrick%')`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM participants WHERE name LIKE 'Tiger%' OR name LIKE 'Eldrick%'`).catch(() => {});
  await prisma.$executeRawUnsafe(
    'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1::uuid)',
    tid,
  ).catch(() => {});
  await prisma.$executeRawUnsafe('DELETE FROM users WHERE tenant_id = $1::uuid', tid).catch(() => {});
}
