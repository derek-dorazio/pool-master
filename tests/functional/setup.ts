import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
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

export function getSdkClient(): Client {
  return createClient(
    createConfig({
      baseUrl: getFunctionalBaseUrl(),
    }),
  );
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

  return client;
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

  return client;
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
  await database.rosterPick.deleteMany({
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
        rosterPick: {
          sportEventParticipantId: {
            in: sportEventParticipantIds,
          },
        },
      },
    },
  });
  await database.contestEntryParticipantScore.deleteMany({
    where: {
      rosterPick: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.draftPickHistory.deleteMany({
    where: {
      rosterPick: {
        sportEventParticipantId: {
          in: sportEventParticipantIds,
        },
      },
    },
  });
  await database.rosterPick.deleteMany({
    where: {
      sportEventParticipantId: {
        in: sportEventParticipantIds,
      },
    },
  });
  await database.sportEventParticipantSourceData.deleteMany({
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
  const providerParticipants = providerParticipantIds.length > 0
    ? await database.participant.findMany({
        where: {
          id: {
            in: providerParticipantIds,
          },
        },
        select: {
          id: true,
          sportId: true,
        },
      })
    : [];
  const providerSportIds = [...new Set(
    providerParticipants
      .map((participant) => participant.sportId)
      .filter((sportId): sportId is string => Boolean(sportId)),
  )];
  const leagues = await database.league.findMany({
    where: {
      OR: [
        {
          createdBy: {
            in: userIds,
          },
        },
        {
          memberships: {
            some: {
              userId: {
                in: userIds,
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
          sportEventId: {
            in: providerSportEventIds,
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });
  const contestIds = contests.map((contest) => contest.id);

  if (userIds.length > 0) {
    await database.consentRecord.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });
  }
  await cleanupContestArtifacts(database, contestIds);

  if (leagueIds.length > 0) {
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
    await database.commissionerAuditLog.deleteMany({
      where: {
        leagueId: {
          in: leagueIds,
        },
      },
    });
    await database.commissionerActionItem.deleteMany({
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
    await database.participantSeasonRecord.deleteMany({
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
  if (providerSportIds.length > 0) {
    await database.sport.deleteMany({
      where: {
        id: {
          in: providerSportIds,
        },
        participants: {
          none: {},
        },
      },
    });
  }
  if (userIds.length > 0) {
    await database.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });
    await database.adminAuditEntry.deleteMany({
      where: {
        actorId: {
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

  const payload = result.error as Record<string, unknown> | undefined;
  const nestedError =
    payload?.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
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
