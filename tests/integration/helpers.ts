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
import { startSmtpSinkServer, type SmtpSinkServer } from '../support/smtp-sink';

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
import { accountModule } from '../../packages/core-api/src/modules/account/routes';
import { configModule } from '../../packages/core-api/src/modules/config/routes';
import { draftsModule } from '../../packages/core-api/src/modules/drafts/routes';
import { eventsModule } from '../../packages/core-api/src/modules/events/routes';
import { adminModule } from '../../packages/core-api/src/modules/admin/routes';
import { historyModule } from '../../packages/core-api/src/modules/history/routes';
import { notificationsModule } from '../../packages/core-api/src/modules/notifications/routes';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';
const INTEGRATION_TEST_EMAIL_DOMAIN = '@integration.test';
const INTEGRATION_TEST_PROVIDER_IDS = [
  'integration-test',
  'TEST_PROVIDER',
  'contract-provider',
  'contract-events-provider',
  'PGA',
] as const;

let app: FastifyInstance;
let prisma: PrismaClient;
let integrationSmtpServer: SmtpSinkServer | undefined;
let previousMailEnv: Partial<Record<MailEnvironmentKey, string | undefined>> | undefined;

const MAIL_ENVIRONMENT_KEYS = [
  'EMAIL_PROVIDER',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_FROM',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
] as const;
type MailEnvironmentKey = (typeof MAIL_ENVIRONMENT_KEYS)[number];

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
    prefix: '/api/v1/leagues/:id/contest-management',
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
    logger: testApp.log,
  });
  testApp.register(scoringRoutes, { prefix: '/api/v1', scoringService });
  testApp.register(accountModule, { prefix: '/api/v1/account' });
  testApp.register(accountConsentModule, { prefix: '/api/v1/account' });
  testApp.register(configModule, { prefix: '/api/v1/config' });
  testApp.register(eventsModule, { prefix: '/api/v1/events' });
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
  await cleanupTestData();
  await startIntegrationMailSink();
  app = await buildTestApp();
}

/** Tear down after all tests. */
export async function teardownIntegrationTests(): Promise<void> {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  await stopIntegrationMailSink();
}

async function startIntegrationMailSink(): Promise<void> {
  if (integrationSmtpServer) {
    return;
  }

  previousMailEnv = Object.fromEntries(
    MAIL_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<MailEnvironmentKey, string | undefined>>;

  const sink = await startSmtpSinkServer();
  integrationSmtpServer = sink;

  process.env.EMAIL_PROVIDER = 'smtp';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(sink.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'noreply@integration.test';
  delete process.env.SMTP_USERNAME;
  delete process.env.SMTP_PASSWORD;
}

async function stopIntegrationMailSink(): Promise<void> {
  if (integrationSmtpServer) {
    const server = integrationSmtpServer;
    integrationSmtpServer = undefined;
    await server.close();
  }

  if (previousMailEnv) {
    for (const key of MAIL_ENVIRONMENT_KEYS) {
      const value = previousMailEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousMailEnv = undefined;
  }
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

interface TestUserResult {
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    displayName: string;
    isRootAdmin: boolean;
  };
  headers: Record<string, string>;
  accessToken: string;
}

/**
 * Create a real user in Postgres and return a valid JWT for authenticated requests.
 */
export async function createTestUser(overrides: {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  password?: string;
  isRootAdmin?: boolean;
} = {}): Promise<TestUserResult> {
  const id = randomUUID();
  const email = overrides.email ?? `test-${id.slice(0, 8)}@integration.test`;
  const username = overrides.username ?? email;
  const fallbackName = overrides.displayName ?? `Test User ${id.slice(0, 8)}`;
  const [fallbackFirstName, ...fallbackLastParts] = fallbackName.split(/\s+/);
  const firstName = overrides.firstName ?? fallbackFirstName ?? 'Test';
  const lastName = overrides.lastName ?? (fallbackLastParts.join(' ').trim() || 'User');
  const passwordHash = await bcrypt.hash(overrides.password ?? 'TestPass123', 10);

  const user = await prisma.user.create({
    data: {
      id,
      email,
      username,
      firstName,
      lastName,
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
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`,
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
 * Build a contest-eligible event timing window relative to "now" so tests do
 * not silently become stale as calendar time advances.
 */
export function buildContestEligibleEventTiming(now: Date = new Date()): {
  sourceReceivedAt: Date;
  releaseAt: Date;
  entryLocksAt: Date;
  fieldLocksAt: Date;
  startDate: Date;
} {
  const sourceReceivedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const releaseAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const entryLocksAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const fieldLocksAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startDate = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  return {
    sourceReceivedAt,
    releaseAt,
    entryLocksAt,
    fieldLocksAt,
    startDate,
  };
}

async function cleanupContestArtifacts(
  database: PrismaClient,
  contestIds: string[],
): Promise<void> {
  if (contestIds.length === 0) {
    return;
  }

  await database.contestEntryParticipantScoreEvent.deleteMany({
    where: {
      participantScore: {
        entry: {
          contestId: {
            in: contestIds,
          },
        },
      },
    },
  });
  await database.contestEntryParticipantScore.deleteMany({
    where: {
      entry: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.draftPickHistory.deleteMany({
    where: {
      entry: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.contestEntryPrizeAward.deleteMany({
    where: {
      entry: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  // pool-master-rop.78.7 — golf-roster contribution rows reference picks
  // via FK; they have to drop before the picks they belong to.
  await database.contestEntryPickGolfRosterContribution.deleteMany({
    where: {
      pick: {
        entry: {
          contestId: {
            in: contestIds,
          },
        },
      },
    },
  });
  await database.contestEntryPick.deleteMany({
    where: {
      entry: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.contestEntry.deleteMany({
    where: {
      contestId: {
        in: contestIds,
      },
    },
  });
  await database.draftSession.deleteMany({
    where: {
      contestId: {
        in: contestIds,
      },
    },
  });
  await database.participantContestScoringRule.deleteMany({
    where: {
      contestConfiguration: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.contestEntryAggregationRule.deleteMany({
    where: {
      contestConfiguration: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.contestPrizeDefinition.deleteMany({
    where: {
      contestConfiguration: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  await database.contestConfiguration.deleteMany({
    where: {
      contestId: {
        in: contestIds,
      },
    },
  });
  await database.contest.deleteMany({
    where: {
      id: {
        in: contestIds,
      },
    },
  });
}

async function cleanupSportEventParticipantArtifacts(
  database: PrismaClient,
  sportEventParticipantIds: string[],
): Promise<void> {
  if (sportEventParticipantIds.length === 0) {
    return;
  }

  await database.contestEntryParticipantScoreEvent.deleteMany({
    where: {
      participantScore: {
        pick: {
          sportEventParticipantId: {
            in: sportEventParticipantIds,
          },
        },
      },
    },
  });
  await database.contestEntryParticipantScore.deleteMany({
    where: {
      pick: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.draftPickHistory.deleteMany({
    where: {
      pick: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  // pool-master-rop.78.7 — contribution rows reach SEP through pick.
  // They have to drop before the picks.
  await database.contestEntryPickGolfRosterContribution.deleteMany({
    where: {
      pick: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.contestEntryPick.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  await database.sportEventParticipantValuation.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  // pool-master-rop.78.12 — per-round detail reaches SEP via FK.
  await database.sportEventParticipantGolfRound.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  await database.sportEventParticipant.deleteMany({
    where: {
      id: {
        in: sportEventParticipantIds,
      },
    },
  });
}

/**
 * Clean up test data created during tests.
 * Deletes in reverse dependency order using explicit relation-aware Prisma filters.
 */
export async function cleanupTestData(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      email: {
        endsWith: INTEGRATION_TEST_EMAIL_DOMAIN,
      },
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const providerSportEvents = await prisma.sportEvent.findMany({
    where: {
      providerId: {
        in: [...INTEGRATION_TEST_PROVIDER_IDS],
      },
    },
    select: { id: true },
  });
  const providerSportEventIds = providerSportEvents.map((event) => event.id);
  const providerSportEventParticipants = providerSportEventIds.length
    ? await prisma.sportEventParticipant.findMany({
        where: {
          sportEventId: {
            in: providerSportEventIds,
          },
        },
        select: {
          id: true,
          participantId: true,
        },
      })
    : [];
  const providerSportEventParticipantIds = providerSportEventParticipants.map((participant) => participant.id);

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
  const contests = (leagueIds.length || providerSportEventIds.length)
    ? await prisma.contest.findMany({
        where: {
          OR: [
            { leagueId: { in: leagueIds } },
            { sportEventId: { in: providerSportEventIds } },
          ],
        },
        select: { id: true },
      })
    : [];
  const contestIds = contests.map((contest) => contest.id);

  await cleanupContestArtifacts(prisma, contestIds);
  await cleanupSportEventParticipantArtifacts(prisma, providerSportEventParticipantIds);

  if (leagueIds.length > 0) {
    await prisma.squadMembership.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.squad.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.commissionerAuditLog.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.commissionerActionItem.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.leagueInvitation.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.leagueMembership.deleteMany({
      where: { leagueId: { in: leagueIds } },
    });
    await prisma.league.deleteMany({
      where: { id: { in: leagueIds } },
    });
  }

  await prisma.providerSyncRun.deleteMany();
  await prisma.sportEventParticipantValuation.deleteMany();
  await prisma.sportEventParticipant.deleteMany();
  await prisma.participantProviderMapping.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.sportEvent.deleteMany();
  await prisma.sport.deleteMany();

  await prisma.platformRuntimeConfig.deleteMany();
  if (userIds.length > 0) {
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    }).catch(() => {});
    await prisma.adminAuditEntry.deleteMany({
      where: { actorId: { in: userIds } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    }).catch(() => {});
  }
}
