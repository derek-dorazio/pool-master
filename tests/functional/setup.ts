import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { cleanupFreshEventEditions } from '../support/event-edition';
const FUNCTIONAL_TEST_EMAIL_DOMAIN = '@functional.test';
const FUNCTIONAL_TEST_PROVIDER_IDS = ['functional-test', 'integration-test'] as const;
const FUNCTIONAL_PROVIDER_PREFIX = 'functional-provider-';

export interface FunctionalServerState {
  pid: number;
  port: number;
  baseUrl: string;
  runId: string;
}

export interface FunctionalErrorExpectation {
  status: number;
  code: string;
}

function getStateFilePath(): string {
  const configuredPath = process.env.FUNCTIONAL_SERVER_STATE_FILE;
  if (configuredPath) {
    return configuredPath;
  }

  const invocationId = process.env.FUNCTIONAL_INVOCATION_ID;
  if (invocationId) {
    return path.join(
      process.cwd(),
      'coverage',
      'service-functional-api',
      'runs',
      invocationId,
      'server-state.json',
    );
  }

  return path.join(
    process.cwd(),
    'coverage',
    'service-functional-api',
    'server-state.json',
  );
}

let prisma: PrismaClient | undefined;
const DAEMON_STATE_FILE_PATH = path.join(
  process.cwd(),
  'coverage',
  'service-functional-api',
  'daemon',
  'server-state.json',
);

function readStateFile(filePath: string): Partial<FunctionalServerState> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<FunctionalServerState>;
  } catch {
    return null;
  }
}

function readState(): FunctionalServerState {
  const stateFilePath = getStateFilePath();
  const parsed = readStateFile(stateFilePath)
    ?? (() => {
      const daemonState = readStateFile(DAEMON_STATE_FILE_PATH);
      if (!daemonState) {
        return null;
      }

      const runId = process.env.FUNCTIONAL_RUN_ID;
      return {
        ...daemonState,
        runId: typeof runId === 'string' && runId.length > 0
          ? runId
          : daemonState.runId,
      } satisfies Partial<FunctionalServerState>;
    })();

  if (
    !parsed ||
    typeof parsed.pid !== 'number' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.baseUrl !== 'string' ||
    typeof parsed.runId !== 'string'
  ) {
    throw new Error(
      `Functional server state file not found at ${stateFilePath}. ` +
        'Did the functional global setup run?',
    );
  }

  return parsed as FunctionalServerState;
}

export function getFunctionalServerState(): FunctionalServerState {
  return readState();
}

export function getFunctionalRunId(): string {
  return readState().runId;
}

export function getFunctionalBaseUrl(): string {
  return readState().baseUrl;
}

/**
 * A write to one event: its status change (a COMPLETED or CANCELLED settles its contests in a job,
 * #1448), or a game's result, late quarter score or cancellation (its squares contests settle in a
 * job, #1460).
 */
const EVENT_WRITE_PATH = /\/api\/v1\/events\/([^/]+)\//;
const JOB_WAIT_MS = 30_000;
const JOB_POLL_MS = 50;

type JobWhere = NonNullable<Parameters<ReturnType<typeof getFunctionalPrisma>['backgroundJob']['findMany']>[0]>['where'];

/**
 * Waits until the jobs `where` names have run. A job that fails, or is still waiting after
 * JOB_WAIT_MS, fails the test with its last error. Callers name only the jobs queued since their
 * write was sent, so an earlier test's failed job never fails a later one.
 */
async function awaitJobs(what: string, where: JobWhere): Promise<void> {
  const database = getFunctionalPrisma();
  const deadline = Date.now() + JOB_WAIT_MS;
  for (;;) {
    const unfinished = await database.backgroundJob.findMany({
      where: { ...where, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { status: true },
    });
    const failed = await database.backgroundJob.findFirst({
      where: { ...where, OR: [{ status: 'FAILED' }, { status: 'QUEUED', attempts: { gt: 0 } }] },
      select: { lastError: true },
    });
    if (failed) throw new Error(`${what} failed: ${failed.lastError ?? 'no error recorded'}`);
    if (unfinished.length === 0) return;
    if (Date.now() > deadline) throw new Error(`${what} was still ${unfinished[0]?.status} after ${JOB_WAIT_MS} ms`);
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
}

/**
 * Waits until the jobs settling this event's contests have run. The server settles a finished
 * event, or a decided game's squares contests, in a background job after the write answers, and
 * the scenarios read the settled standings next, as a member would once the job is done.
 */
export async function awaitEventSettlementJobs(sportEventId: string, since: Date): Promise<void> {
  await awaitJobs(`Settling event ${sportEventId}'s contests`, {
    type: { in: ['SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS'] },
    payload: { path: ['sportEventId'], equals: sportEventId },
    createdAt: { gte: since },
  });
}

/**
 * Waits until every leaderboard rebuild queued since `since` has run. A write that changes what boards are
 * computed from (a score, a field, a status, a pick'em week, a settlement) rebuilds them in a job
 * after it answers (#1463), and the scenarios read the board next, as a member's next poll would.
 */
async function awaitLeaderboardRebuildJobs(since: Date): Promise<void> {
  await awaitJobs('Rebuilding leaderboards', { type: 'REBUILD_LEADERBOARDS', createdAt: { gte: since } });
}

/** When each write was sent: the jobs it queued are the ones created since. */
const writeSentAt = new WeakMap<Request, Date>();

/**
 * A successful write answers only once the jobs it queued for what the scenarios read next have
 * run: an event's settling jobs, then the board rebuilds any write (settlement included) queued.
 */
function waitingForQueuedJobs(client: Client): Client {
  client.interceptors.request.use((request: Request) => {
    if (request.method !== 'GET') writeSentAt.set(request, new Date());
    return request;
  });
  client.interceptors.response.use(async (response: Response, request: Request) => {
    const sentAt = writeSentAt.get(request);
    if (!sentAt || !response.ok) return response;
    const write = EVENT_WRITE_PATH.exec(new URL(request.url).pathname);
    if (write?.[1]) await awaitEventSettlementJobs(decodeURIComponent(write[1]), sentAt);
    await awaitLeaderboardRebuildJobs(sentAt);
    return response;
  });
  return client;
}

export function getSdkClient(): Client {
  return waitingForQueuedJobs(createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  ));
}

export function createAuthenticatedClient(accessToken: string): Client {
  const client = createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  );

  client.interceptors.request.use((request: Request) => {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  });

  return waitingForQueuedJobs(client);
}

export function createCookieSessionClient(session: {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}, options?: {
  includeCsrfHeader?: boolean;
}): Client {
  const client = createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  );

  const cookieHeader = [
    `poolmaster_access=${encodeURIComponent(session.accessToken)}`,
    `poolmaster_refresh=${encodeURIComponent(session.refreshToken)}`,
    `poolmaster_csrf=${encodeURIComponent(session.csrfToken)}`,
  ].join('; ');

  client.interceptors.request.use((request: Request) => {
    request.headers.set('Cookie', cookieHeader);
    if (options?.includeCsrfHeader !== false) {
      request.headers.set('X-CSRF-Token', session.csrfToken);
    }
    return request;
  });

  return waitingForQueuedJobs(client);
}

export function getFunctionalPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectFunctionalPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}

async function cleanupContestArtifacts(
  database: PrismaClient,
  contestIds: string[],
): Promise<void> {
  if (contestIds.length === 0) {
    return;
  }

  await database.contestEntryPick.deleteMany({
    where: {
      entry: {
        contestId: {
          in: contestIds,
        },
      },
    },
  });
  // The golf extension cascades from the core standing.
  await database.contestEntryStanding.deleteMany({
    where: {
      contestId: {
        in: contestIds,
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
  await database.participantContestScoringRule.deleteMany({
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

  await database.contestEntryPick.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  // Matches name field rows and each other with RESTRICT foreign keys, so the whole bracket of
  // an event goes before its teams.
  await database.sportEventMatch.deleteMany({
    where: {
      sportEvent: {
        sportEventParticipants: { some: { id: { in: sportEventParticipantIds } } },
      },
    },
  });
  await database.sportEventParticipantGolfRound.deleteMany({
    where: {
      participantRound: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.sportEventParticipantStatLine.deleteMany({
    where: {
      participantRound: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.sportEventParticipantRound.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  await database.sportEventParticipantGolfStanding.deleteMany({
    where: {
      standing: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.sportEventParticipantStanding.deleteMany({
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
  await database.sportEventParticipant.deleteMany({
    where: {
      id: {
        in: sportEventParticipantIds,
      },
    },
  });
}

export async function cleanupFunctionalData(): Promise<void> {
  const database = getFunctionalPrisma();

  const users = await database.user.findMany({
    where: {
      email: {
        endsWith: FUNCTIONAL_TEST_EMAIL_DOMAIN,
      },
    },
    select: {
      id: true,
    },
  });
  const userIds = users.map((user) => user.id);
  const providerSportEvents = await database.sportEvent.findMany({
    where: {
      providerId: {
        in: [...FUNCTIONAL_TEST_PROVIDER_IDS],
      },
    },
    select: {
      id: true,
    },
  });
  const providerSportEventIds = providerSportEvents.map((event) => event.id);
  const providerSportEventParticipants = providerSportEventIds.length > 0
    ? await database.sportEventParticipant.findMany({
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
  const providerSportEventParticipantIds = providerSportEventParticipants.map(
    (participant) => participant.id,
  );
  const providerParticipantIds = [...new Set(
    providerSportEventParticipants.map((participant) => participant.participantId),
  )];
  const leagues = await database.league.findMany({
    // #202 — no `createdBy` arm. League creation always writes the creator's
    // COMMISSIONER membership, so the membership filter already covers them.
    where: {
      memberships: {
        some: {
          userId: {
            in: userIds,
          },
        },
      },
    },
    select: {
      id: true,
    },
  });
  const leagueIds = leagues.map((league) => league.id);
  const contests = await database.contest.findMany({
    where: {
      OR: [
        {
          leagueId: {
            in: leagueIds,
          },
        },
        {
          sportEvents: {
            some: {
              sportEventId: {
                in: providerSportEventIds,
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });
  const contestIds = contests.map((contest) => contest.id);

  await cleanupContestArtifacts(database, contestIds);

  if (leagueIds.length > 0) {
    // The outbox keeps an email when what it is about goes, so the test leagues' emails go first.
    await database.emailMessage.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.leagueInvitation.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.leagueMembership.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.squadMembership.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.squadOwnerInvitation.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.squad.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.league.deleteMany({
      where: {
        id: {
          in: leagueIds,
        },
      },
    });
  }
  await cleanupSportEventParticipantArtifacts(database, providerSportEventParticipantIds);
  if (providerSportEventIds.length > 0) {
    await database.sportEvent.deleteMany({
      where: {
        id: {
          in: providerSportEventIds,
        },
      },
    });
  }
  await cleanupFreshEventEditions(database);
  await database.providerSyncRun.deleteMany({
    where: {
      OR: [
        {
          providerId: {
            in: [...FUNCTIONAL_TEST_PROVIDER_IDS],
          },
        },
        {
          providerId: {
            startsWith: FUNCTIONAL_PROVIDER_PREFIX,
          },
        },
      ],
    },
  });
  if (providerParticipantIds.length > 0) {
    await database.participantProviderMapping.deleteMany({
      where: {
        participantId: {
          in: providerParticipantIds,
        },
      },
    });
    await database.participant.deleteMany({
      where: {
        id: {
          in: providerParticipantIds,
        },
        sportEventParticipants: {
          none: {},
        },
        providerMappings: {
          none: {},
        },
      },
    });
  }
  // Sports are migration reference data: a participant's sport row stays when its last test
  // participant goes, or every suite after this one finds no sport to load into.
  if (userIds.length > 0) {
    await database.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });
    await database.passwordResetToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });
  }
  await database.platformRuntimeConfig.deleteMany();
  if (userIds.length > 0) {
    await database.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }
}

export function expectFunctionalError(
  result: { error?: unknown; response?: Response | undefined; data?: unknown },
  expected: FunctionalErrorExpectation,
): void {
  expect(result.data).toBeUndefined();
  expect(result.response?.status).toBe(expected.status);

  // The standard envelope nests `{ code }` under `error`; a body that never reached the
  // error handler may carry `error` or `code` as a top-level string instead.
  const payload = result.error as { error?: unknown; code?: unknown } | undefined;
  const nestedError =
    payload?.error && typeof payload.error === 'object'
      ? payload.error as { code?: unknown }
      : undefined;
  const actualCode =
    typeof nestedError?.code === 'string'
      ? nestedError.code
      : typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.code === 'string'
          ? payload.code
          : undefined;

  expect(actualCode).toBe(expected.code);
}

export function createFunctionalEmail(prefix = 'pilot'): string {
  const runId = getFunctionalRunId();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `functional-${runId}-${prefix}-${stamp}@functional.test`;
}
