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
import { globalErrorHandler } from '../../packages/core-api/src/core/error-handler';
import { authModule } from '../../packages/core-api/src/modules/auth/routes';
import { leaguesModule } from '../../packages/core-api/src/modules/leagues/routes';
import { squadsModule } from '../../packages/core-api/src/modules/squads/routes';
import { invitationsModule } from '../../packages/core-api/src/modules/invitations/routes';
import { contestsModule, contestsByIdModule } from '../../packages/core-api/src/modules/contests/routes';
import { contestManagementModule } from '../../packages/core-api/src/modules/contest-management/routes';
import { participantsModule } from '../../packages/core-api/src/modules/participants/routes';
import { standingsModule } from '../../packages/core-api/src/modules/standings/routes';
import { scoringRoutes } from '../../packages/core-api/src/modules/scoring/routes';
import { StandingsRollup } from '../../packages/core-api/src/modules/scoring/rollup/standings-rollup';
import { ScoringService } from '../../packages/core-api/src/modules/scoring/service';
import { accountConsentModule } from '../../packages/core-api/src/modules/account-consent/routes';
import { configModule } from '../../packages/core-api/src/modules/config/routes';
import { draftsModule } from '../../packages/core-api/src/modules/drafts/routes';
import { adminModule } from '../../packages/core-api/src/modules/admin/routes';
import { historyModule } from '../../packages/core-api/src/modules/history/routes';
import { notificationsModule } from '../../packages/core-api/src/modules/notifications/routes';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';

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

/** Build the Fastify app with real plugins and modules (no background jobs). */
async function buildTestApp(): Promise<FastifyInstance> {
  const testApp = Fastify({ logger: false });

  testApp.decorate('prisma', prisma);

  // Core plugins
  testApp.register(healthPlugin);
  testApp.register(authGuard);
  testApp.setErrorHandler(globalErrorHandler);

  // Route modules
  testApp.register(authModule, { prefix: '/api/v1/auth' });
  testApp.register(leaguesModule, { prefix: '/api/v1/leagues' });
  testApp.register(squadsModule, { prefix: '/api/v1/leagues/:id/squads' });
  testApp.register(invitationsModule, { prefix: '/api/v1/invitations' });
  testApp.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
  testApp.register(contestManagementModule, {
    prefix: '/api/v1/leagues/:id/contest-management/contests',
  });
  testApp.register(contestsByIdModule, { prefix: '/api/v1/contests' });
  testApp.register(participantsModule, { prefix: '/api/v1/participants' });
  testApp.register(standingsModule, { prefix: '/api/v1/contests/:contestId/standings' });
  const standingsRollup = new StandingsRollup({
    eventBus: {
      publish: async () => undefined,
    } as any,
    prisma,
  });
  const scoringService = new ScoringService({
    standingsRollup,
    prisma,
  });
  testApp.register(scoringRoutes, { prefix: '/api/v1', scoringService });
  testApp.register(accountConsentModule, { prefix: '/api/v1/account' });
  testApp.register(configModule, { prefix: '/api/v1/config' });
  testApp.register(draftsModule, { prefix: '/api/v1/drafts' });
  testApp.register(adminModule, { prefix: '/api/v1/admin' });
  testApp.register(historyModule, { prefix: '/api/v1' });
  testApp.register(notificationsModule, {
    prefix: '/api/v1',
    prisma,
  });

  await testApp.ready();
  return testApp;
}

/** Set up the Fastify app and Prisma client. Called once before all tests. */
export async function setupIntegrationTests(): Promise<void> {
  prisma = new PrismaClient();
  await prisma.$connect();
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
  user: { id: string; email: string; displayName: string; isRootAdmin: boolean };
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
  isRootAdmin?: boolean;
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
      isRootAdmin: overrides.isRootAdmin ?? false,
    },
  });

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '15m' },
  );

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isRootAdmin: user.isRootAdmin,
    },
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
    { sub: userId, email },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

/**
 * Removes JSON body headers for bodyless POST/DELETE requests.
 * Some live Fastify routes reject an empty request body when the
 * content-type implies JSON content is present.
 */
export function withoutJsonBodyHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-type'),
  );
}

/**
 * Build the canonical create-league payload used by integration tests.
 * This mirrors the active public create contract rather than older implicit defaults.
 */
export function buildCreateLeaguePayload(name: string, description?: string): {
  name: string;
  leagueCode: string;
  description?: string;
} {
  return {
    name,
    leagueCode: `INT${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    ...(description ? { description } : {}),
  };
}

/**
 * Clean up test data created during tests.
 * Deletes in reverse dependency order using raw SQL for reliability.
 */
export async function cleanupTestData(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      email: {
        endsWith: '@integration.test',
      },
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  const leagues = userIds.length
    ? await prisma.league.findMany({
        where: {
          OR: [
            { createdBy: { in: userIds } },
            { memberships: { some: { userId: { in: userIds } } } },
          ],
        },
        select: { id: true },
      })
    : [];
  const leagueIds = leagues.map((league) => league.id);
  const contests = leagueIds.length
    ? await prisma.contest.findMany({
        where: { leagueId: { in: leagueIds } },
        select: { id: true },
      })
    : [];
  const contestIds = contests.map((contest) => contest.id);

  // Tables that reference contests
  const contestChildTables = [
    'contest_entry_participant_score_events', 'contest_entry_participant_scores', 'contest_entry_prize_awards',
    'contest_entries',
    'draft_sessions', 'draft_pick_histories',
    'contest_participant_pool', 'contest_pools', 'roster_picks',
    'participant_contest_scoring_rules', 'contest_entry_aggregation_rules', 'contest_prize_definitions', 'contest_configurations',
    'commissioner_audit_log', 'commissioner_action_items', 'discoverable_contests',
  ];
  // Tables that reference leagues
  const leagueChildTables = [
    'squad_memberships', 'squads',
    'discoverable_leagues',
  ];

  for (const table of contestChildTables) {
    if (contestIds.length === 0) break;
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE contest_id = ANY($1::uuid[])`,
      contestIds,
    ).catch(() => {});
  }
  if (contestIds.length > 0) {
    await prisma.contest.deleteMany({
      where: { id: { in: contestIds } },
    }).catch(() => {});
  }

  await prisma.$executeRawUnsafe(
    "DELETE FROM sport_event_participant_source_data WHERE sport_event_participant_id IN (SELECT id FROM sport_event_participants WHERE sport_event_id IN (SELECT id FROM sport_events WHERE provider_id = 'integration-test'))",
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    "DELETE FROM sport_event_participant_valuations WHERE sport_event_participant_id IN (SELECT id FROM sport_event_participants WHERE sport_event_id IN (SELECT id FROM sport_events WHERE provider_id = 'integration-test'))",
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    "DELETE FROM sport_event_participants WHERE sport_event_id IN (SELECT id FROM sport_events WHERE provider_id = 'integration-test')",
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    "DELETE FROM sport_events WHERE provider_id = 'integration-test'",
  ).catch(() => {});

  for (const table of leagueChildTables) {
    if (leagueIds.length === 0) break;
    await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE league_id = ANY($1::uuid[])`,
      leagueIds,
    ).catch(() => {});
  }
  if (leagueIds.length > 0) {
    await prisma.leagueInvitation.deleteMany({
      where: { leagueId: { in: leagueIds } },
    }).catch(() => {});
    await prisma.leagueMembership.deleteMany({
      where: { leagueId: { in: leagueIds } },
    }).catch(() => {});
    await prisma.league.deleteMany({
      where: { id: { in: leagueIds } },
    }).catch(() => {});
  }

  // Participants created during tests (name starts with test pattern)
  await prisma.$executeRawUnsafe(`DELETE FROM participant_season_records WHERE participant_id IN (SELECT id FROM participants WHERE name LIKE 'Tiger%' OR name LIKE 'Eldrick%')`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM participants WHERE name LIKE 'Tiger%' OR name LIKE 'Eldrick%'`).catch(() => {});
  if (userIds.length > 0) {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    }).catch(() => {});
  }
}
