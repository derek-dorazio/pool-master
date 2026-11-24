import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import { randomUUID } from 'node:crypto';
import { Sport } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema, type ContestLeaderboardResponse } from '@poolmaster/shared/dto';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import { MockContestFeedAdapter } from '../../support/mock-contest-feed-provider';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler, publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core';
import { scoringFamilyForEvent } from '../../../packages/core-api/src/modules/scoring-families';
import { createContestSettlementService } from '../../../packages/core-api/src/modules/contests/wiring';
import type { IngestionScheduleConfig } from '../../../packages/shared/dto/config.dto';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  integrationBackgroundJobs,
  setupIntegrationTests,
  teardownIntegrationTests,
  integrationSyncFindings,
} from '../helpers';
import { startMockContestFeedProvider } from '../mock-contest-feed-provider-helper';
import { linkedProviderEvent } from '../../support/event-edition';
import { readStoredSyncRunDetails, readStoredSyncRunPayload } from '../../support/sync-run-payload';
import {
  PrismaBackgroundJobRepository,
  PrismaProviderSyncRunRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
} from '../../../packages/core-api/src/adapters';
import { expectDefined } from '../../support/expect-defined';
import { forgetStoredLeaderboards, passReadCacheTtl, restoreReadCacheClock } from '../../support/read-cache-clock';
import { golfRoundsOf } from '../../support/live-score-rounds';

const providerId = 'balldontlie';
/** The mock feed's golf events: the fake answers as BALLDONTLIE, and its event ids start `golf-`. */
const MOCK_FEED_EVENTS = { providerId, externalId: { startsWith: 'golf-' } };
const eventExternalId = 'golf-masters-2026';
const syncVerificationNow = new Date('2026-05-30T12:00:00.000Z');
const syncVerificationConfig: IngestionScheduleConfig = {
  healthCheck: { enabled: true, intervalMinutes: 5 },
  // Every unstarted event in the lookahead takes field syncs (#431 removed the release
  // window), so a week keeps the scheduled pass to the one event this suite asserts on.
  eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 7 },
  eventLiveScores: { enabled: false, intervalSeconds: 30 },
  eventList: { enabled: true, intervalMinutes: 360 },
};

function emptyLiveScorePersistenceResult() {
  return {
    updatesReturned: 0,
    updatesPersisted: 0,
    updatesSkipped: 0,
    writeDiagnostics: {
      summary: {
        total: 0,
        unchanged: 0,
        created: 0,
        updated: 0,
        deleted: 0,
      },
      rows: [],
    },
  };
}

let mockProvider: Awaited<ReturnType<typeof startMockContestFeedProvider>>;
let importedParticipantExternalIds: string[] = [];
let integrationSetupComplete = false;

async function cleanupMockProviderImportData(): Promise<void> {
  if (!integrationSetupComplete) {
    return;
  }

  const prisma = getPrisma();
  // The fake answers as BALLDONTLIE (#2040), so this suite's rows are the mock feed's golf events
  // and the participants on their fields, not every BALLDONTLIE row.
  const fieldRows = await prisma.sportEventParticipant.findMany({
    where: { sportEvent: MOCK_FEED_EVENTS },
    select: { participantId: true },
  });
  const participantIds = [...new Set(fieldRows.map((row) => row.participantId))];

  await prisma.sportEventParticipantValuation.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: MOCK_FEED_EVENTS,
      },
    },
  });
  await prisma.sportEventParticipantGolfRound.deleteMany({
    where: {
      participantRound: {
        sportEventParticipant: {
          sportEvent: MOCK_FEED_EVENTS,
        },
      },
    },
  });
  await prisma.sportEventParticipantRound.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: MOCK_FEED_EVENTS,
      },
    },
  });
  await prisma.sportEventParticipantGolfStanding.deleteMany({
    where: {
      standing: {
        sportEventParticipant: {
          sportEvent: MOCK_FEED_EVENTS,
        },
      },
    },
  });
  await prisma.sportEventParticipantStanding.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: MOCK_FEED_EVENTS,
      },
    },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: MOCK_FEED_EVENTS,
    },
  });
  await prisma.providerSyncRun.deleteMany({ where: { sportEvent: MOCK_FEED_EVENTS } });
  await prisma.sportEvent.deleteMany({ where: MOCK_FEED_EVENTS });
  if (participantIds.length > 0) {
    await prisma.participantProviderMapping.deleteMany({ where: { participantId: { in: participantIds } } });
    // One still on another suite's field stays.
    await prisma.participant.deleteMany({ where: { id: { in: participantIds }, sportEventParticipants: { none: {} } } });
  }
  importedParticipantExternalIds = [];
}

// Sync runs complete asynchronously. The wait is a deadline, not an attempt count: 80 × 25 ms
// polls (about 2 s, plus query time) was enough locally, where the slowest run takes ~1 s under
// coverage, but not on a loaded CI runner — the field sync timed out there on #259 with no code
// change on that path. A stuck run still fails here, well inside Jest's 30 s test timeout.
/**
 * plans/147 — sync updates the events already linked to provider events and never creates
 * one, so a sync scenario starts where an admin would leave it: the `golf-major-2026`
 * scenario's events in the window created and linked. That is the fixed season these tests are
 * written against. The mock also serves the PGA TOUR and LPGA tour seeds (#383); they are left
 * unlinked, so they stay out of every sync these tests run.
 */
/**
 * Links an event to each golf-major-2026 provider event, as an admin creating each one from the
 * provider's catalog would: the field release and lock times are the provider's. Nothing
 * schedules a refresh of them afterwards (#126).
 */
async function linkProviderGolfEvents(from: Date, to: Date): Promise<number> {
  const events = (await new MockContestFeedAdapter(mockProvider.baseUrl).getUpcomingEvents(Sport.GOLF, { from, to }))
    .filter((event) => event.metadata['scenarioId'] === 'golf-major-2026');
  for (const event of events) {
    await linkedProviderEvent(getPrisma(), {
      providerId: event.providerId,
      externalId: event.externalId,
      name: event.name,
      startDate: event.startDate,
    });
  }
  return events.length;
}

const SYNC_RUN_WAIT_MS = 10_000;

async function waitForProviderSyncRuns(ids: string[]) {
  const idOrder = new Map(ids.map((id, index) => [id, index]));
  const deadline = Date.now() + SYNC_RUN_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await getPrisma().providerSyncRun.findMany({
      where: { id: { in: ids } },
    });
    const terminalRows = rows.filter((row) => row.status === 'COMPLETED' || row.status === 'FAILED');
    if (rows.length === ids.length && terminalRows.length === ids.length) {
      const failedRun = rows.find((row) => row.status === 'FAILED');
      if (failedRun) {
        throw new Error(`Provider sync run ${failedRun.id} failed: ${JSON.stringify({ payload: failedRun.payloadJson, details: failedRun.detailsJson })}`);
      }
      return rows.sort((left, right) => (idOrder.get(left.id) ?? 0) - (idOrder.get(right.id) ?? 0));
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for provider sync runs: ${ids.join(', ')}`);
}

async function waitForScheduledProviderSyncRuns(providerIdToFind: string, expectedRunCount: number) {
  const deadline = Date.now() + SYNC_RUN_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await getPrisma().providerSyncRun.findMany({
      where: { providerId: providerIdToFind }, include: { sportEvent: { select: { externalId: true } } },
    });
    const scheduledRows = rows.filter((run) =>
      readStoredSyncRunPayload(run.payloadJson)?.requestPayload?.source === 'SCHEDULED',
    );
    const terminalRows = scheduledRows.filter((row) => row.status === 'COMPLETED' || row.status === 'FAILED');
    if (scheduledRows.length >= expectedRunCount && terminalRows.length >= expectedRunCount) {
      const failedRun = scheduledRows.find((row) => row.status === 'FAILED');
      if (failedRun) {
        throw new Error(`Scheduled provider sync run ${failedRun.id} failed: ${JSON.stringify({ payload: failedRun.payloadJson, details: failedRun.detailsJson })}`);
      }
      return scheduledRows;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for ${expectedRunCount} scheduled provider sync runs for ${providerIdToFind}`);
}

function providerPayloadPaths(detailsJson: unknown): string[] {
  const captures = readStoredSyncRunDetails(detailsJson)?.providerPayload?.raw ?? [];
  return captures.flatMap((capture) => (capture.path === undefined ? [] : [capture.path]));
}

async function findEventParticipantByExternalIds(input: {
  providerId: string;
  eventExternalId: string;
  participantExternalId: string;
}) {
  const prisma = getPrisma();
  const persistedEvent = await prisma.sportEvent.findUniqueOrThrow({
    where: {
      providerId_externalId: {
        providerId: input.providerId,
        externalId: input.eventExternalId,
      },
    },
    include: { eventSeries: { select: { sportLeagueId: true } } },
  });
  // A feed id names one participant per sport league (#1853): the one in the event's league.
  const participantMapping = await prisma.participantProviderMapping.findUniqueOrThrow({
    where: {
      providerId_externalId_sportLeagueId_participantType: {
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        externalId: input.participantExternalId,
        sportLeagueId: persistedEvent.eventSeries.sportLeagueId,
        participantType: 'INDIVIDUAL',
      },
    },
  });

  return prisma.sportEventParticipant.findUniqueOrThrow({
    where: {
      sportEventId_participantId: {
        sportEventId: persistedEvent.id,
        participantId: participantMapping.participantId,
      },
    },
  });
}

async function loadSportEventParticipants(participantExternalIds: string[]) {
  const entries = await Promise.all(
    participantExternalIds.map(async (participantExternalId) => [
      participantExternalId,
      await findEventParticipantByExternalIds({
        providerId,
        eventExternalId,
        participantExternalId,
      }),
    ] as const),
  );
  return new Map(entries);
}

function requiredSportEventParticipantId(
  participantsByExternalId: Map<string, Awaited<ReturnType<typeof findEventParticipantByExternalIds>>>,
  participantExternalId: string,
): string {
  const participant = participantsByExternalId.get(participantExternalId);
  if (!participant) {
    throw new Error(`Expected sport event participant for ${participantExternalId}`);
  }
  return participant.id;
}

async function createGolfLiveVerificationContests(input: {
  ownerUserId: string;
  sportEventId: string;
  directPicks: {
    leader: string[];
    chaser: string[];
  };
}) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const league = await prisma.league.create({
    data: {
      cupName: 'Test Cup', leagueCode: `GLE${suffix}`,
      name: `Golf Live E2E League ${suffix}`,
    },
  });
  await prisma.leagueMembership.create({
    data: {
      leagueId: league.id,
      userId: input.ownerUserId,
      role: 'COMMISSIONER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const [leaderSquad, chaserSquad] = await Promise.all([
    prisma.squad.create({
      data: {
        leagueId: league.id,
        createdBy: input.ownerUserId,
        name: `Live Leader ${suffix}`,
      },
    }),
    prisma.squad.create({
      data: {
        leagueId: league.id,
        createdBy: input.ownerUserId,
        name: `Live Chaser ${suffix}`,
      },
    }),
  ]);
  await prisma.squadMembership.create({
    data: {
      leagueId: league.id,
      squadId: leaderSquad.id,
      userId: input.ownerUserId,
      status: 'ACTIVE',
    },
  });

  const directContest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      seasonYear: 2026,
      sportEvents: { create: { sportEventId: input.sportEventId, sequence: 1 } },
      name: `Direct Golf Live E2E ${suffix}`,
      status: 'ACTIVE',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
    },
  });
  await createGolfLiveContestConfiguration(directContest.id);
  const directEntries = await createGolfLiveEntries({
    contestId: directContest.id,
    sportEventId: input.sportEventId,
    leaderSquadId: leaderSquad.id,
    chaserSquadId: chaserSquad.id,
    leaderPicks: input.directPicks.leader,
    chaserPicks: input.directPicks.chaser,
  });

  return { directContest, directEntries };
}

async function createGolfLiveContestConfiguration(contestId: string) {
  return getPrisma().contestConfiguration.create({
    data: {
      contestId,
      selectionType: 'TIERED',
      configJson: {
        selectionType: 'TIERED',
        picksPerTier: 1,
        countedScores: 2,
      },
      // Every configuration carries its scoring rule (#246); there is no golf fallback.
      participantScoringRules: {
        create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
      },
    },
  });
}

async function createGolfLiveEntries(input: {
  contestId: string;
  sportEventId: string;
  leaderSquadId: string;
  chaserSquadId: string;
  leaderPicks: string[];
  chaserPicks: string[];
}) {
  const prisma = getPrisma();
  const [leader, chaser] = await Promise.all([
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.leaderSquadId,
        entryNumber: 1,
        name: `Leader ${input.contestId.slice(0, 8)}`,
        events: { create: { sportEventId: input.sportEventId, status: 'SUBMITTED', submittedAt: new Date() } },
      },
    }),
    prisma.contestEntry.create({
      data: {
        contestId: input.contestId,
        squadId: input.chaserSquadId,
        entryNumber: 2,
        name: `Chaser ${input.contestId.slice(0, 8)}`,
        events: { create: { sportEventId: input.sportEventId, status: 'SUBMITTED', submittedAt: new Date() } },
      },
    }),
  ]);
  await Promise.all([
    ...input.leaderPicks.map((sportEventParticipantId) => createGolfLivePick(leader.id, sportEventParticipantId)),
    ...input.chaserPicks.map((sportEventParticipantId) => createGolfLivePick(chaser.id, sportEventParticipantId)),
  ]);

  return { leader, chaser };
}

async function createGolfLivePick(entryId: string, sportEventParticipantId: string) {
  return getPrisma().contestEntryPick.create({
    data: { entryId, sportEventParticipantId },
  });
}

/** The board as a viewer's next poll reads it, after scores the test wrote without a write that tells (#1435). */
async function readGolfLeaderboard(contestId: string, headers: Record<string, string>) {
  passReadCacheTtl();
  await forgetStoredLeaderboards(getPrisma());
  const response = await getApp().inject({
    method: 'GET',
    url: `/api/v1/contests/${contestId}/leaderboard`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  return ContestLeaderboardResponseSchema.parse(response.json());
}

/** A picked golfer's event total against par, read from the field the picks point into. */
function fieldScore(leaderboard: ContestLeaderboardResponse, sportEventParticipantId: string) {
  return leaderboard.participants.find((participant) => participant.id === sportEventParticipantId)
    ?.standing?.golf?.eventScoreToPar ?? null;
}

beforeAll(async () => {
  await setupIntegrationTests();
  integrationSetupComplete = true;
  mockProvider = await startMockContestFeedProvider({
    routes: {
      scenarioStoreOptions: {
        now: () => syncVerificationNow,
      },
    },
  });
});

afterEach(async () => {
  restoreReadCacheClock();
  await cleanupTestData();
  await cleanupMockProviderImportData();
});

afterAll(async () => {
  if (!integrationSetupComplete) {
    return;
  }

  await cleanupTestData();
  await cleanupMockProviderImportData();
  await mockProvider.close();
  await teardownIntegrationTests();
});

describe('mock contest feed provider event-first verification', () => {
  it('serves event detail and feed endpoints with schedule and field data, and no longer serves a rankings, results or updates feed', async () => {
    const app = mockProvider.app;

    const eventListResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events',
    });
    expect(eventListResponse.statusCode).toBe(200);
    expect(eventListResponse.json()).toMatchObject({
      scenarioId: 'golf-major-2026',
      events: expect.arrayContaining([
        expect.objectContaining({
          eventId: eventExternalId,
          releaseAt: expect.any(String),
          fieldLocksAt: expect.any(String),
          fieldStatus: expect.any(String),
          contestantCount: expect.any(Number),
        }),
      ]),
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/v1/scenarios/golf-major-2026/events/${eventExternalId}/detail`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      scenarioId: 'golf-major-2026',
      sport: 'GOLF',
      season: expect.objectContaining({
        seasonId: expect.any(String),
        year: expect.any(Number),
      }),
      event: expect.objectContaining({
        eventId: eventExternalId,
        schedule: expect.objectContaining({
          startsAt: expect.any(String),
          releaseAt: expect.any(String),
          fieldLocksAt: expect.any(String),
        }),
        field: expect.objectContaining({
          asOf: expect.any(String),
          status: expect.any(String),
          contestants: expect.arrayContaining([
            expect.objectContaining({
              contestantId: expect.any(String),
              name: expect.any(String),
            }),
          ]),
        }),
        feeds: expect.objectContaining({
          odds: expect.objectContaining({
            asOf: expect.any(String),
            contestants: expect.any(Array),
          }),
          results: expect.objectContaining({
            asOf: expect.any(String),
            contestants: expect.any(Array),
          }),
        }),
      }),
    });

    // #125 — the rankings feed is retired, not demoted: no feed snapshot, no route.
    expect(detailResponse.json<{ event: { feeds: Record<string, unknown> } }>().event.feeds).not.toHaveProperty('rankings');
    const retiredRankingsResponse = await app.inject({
      method: 'GET',
      url: `/v1/scenarios/golf-major-2026/events/${eventExternalId}/rankings`,
    });
    expect(retiredRankingsResponse.statusCode).toBe(404);

    // #126 — the results snapshot and the updates and bare event routes are retired: final
    // standings come from the scores the live feed already delivered.
    for (const retiredPath of ['/results', '/updates', '']) {
      const retiredResponse = await app.inject({
        method: 'GET',
        url: `/v1/scenarios/golf-major-2026/events/${eventExternalId}${retiredPath}`,
      });
      expect(retiredResponse.statusCode).toBe(404);
    }
  });

  it('pool-master-rop.68.1.3 bridges the real mock provider into adapter ingestion persistence, each golfer\'s ranking taken from the field', async () => {
    const prisma = getPrisma();
    const adapter = new MockContestFeedAdapter(mockProvider.baseUrl);
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());

    const events = await adapter.getUpcomingEvents(Sport.GOLF, {
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-30T23:59:59.999Z'),
    });
    const mastersEvent = events.find((event) => event.externalId === eventExternalId);

    expect(mastersEvent).toBeDefined();
    expect(mastersEvent?.metadata).toMatchObject({
      eventType: expect.any(String),
    });

    const detail = await adapter.getEventDetails(eventExternalId);
    expect(detail).not.toBeNull();
    expect(detail?.participants.length).toBeGreaterThan(0);

    importedParticipantExternalIds = detail?.participants.map((participant) => participant.externalId) ?? [];

    // pool-master-rop.78.3 + pool-master-33l.8.8 — typed LiveScoreResult contract
    // per plans/117 §10.2, now driven through explicit mock live-state control.
    adapter.pinEventState(eventExternalId, 'live');
    const liveScores = await adapter.getLiveScores(eventExternalId);
    expect(liveScores.category).toBe('GOLF');
    expect(golfRoundsOf(liveScores).length).toBeGreaterThan(0);
    expect(golfRoundsOf(liveScores)[0]).toEqual(
      expect.objectContaining({
        participantExternalId: expect.any(String),
        round: expect.any(Number),
        status: expect.stringMatching(/IN_PROGRESS|COMPLETED|DNF|DSQ|MISSED_CUT/),
      }),
    );

    // plans/147 — sync updates the event linked to this provider event; it never creates one.
    await linkedProviderEvent(prisma, {
      providerId: expectDefined(detail).providerId,
      externalId: expectDefined(detail).externalId,
      name: expectDefined(detail).name,
      startDate: expectDefined(detail).startDate,
    });

    const persistDetailResult = (await persistence.persistEventDetailWithDiagnostics(expectDefined(detail))).value;
    expect(persistDetailResult.eventsPersisted).toBe(1);
    expect(persistDetailResult.participantsPersisted).toBe(detail?.participants.length);
    expect(persistDetailResult.sportEventParticipantsPersisted).toBe(detail?.participants.length);

    await expect(persistence.persistEventDetailWithDiagnostics(expectDefined(detail)).then((result) => result.value)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: detail?.participants.length,
      sportEventParticipantsPersisted: detail?.participants.length,
    });

    const persistedEvent = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
    });
    // #435 — the provider's metadata never reaches the admin-owned event; only the field size does.
    expect(persistedEvent.metadata).toEqual({});
    expect(persistedEvent.participantCount).toBe(detail?.participants.length);

    const participantMappings = await prisma.participantProviderMapping.findMany({
      where: {
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        externalId: {
          in: importedParticipantExternalIds,
        },
      },
      select: {
        participantId: true,
        externalId: true,
      },
    });
    expect(participantMappings.length).toBe(detail?.participants.length);

    const scottieMapping = participantMappings.find(
      (mapping) => mapping.externalId === 'golfer-01',
    );
    expect(scottieMapping).toBeDefined();
    const scottieEventParticipant = await prisma.sportEventParticipant.findUniqueOrThrow({
      where: {
        sportEventId_participantId: {
          sportEventId: persistedEvent.id,
          participantId: expectDefined(scottieMapping).participantId,
        },
      },
    });
    expect(scottieEventParticipant.ranking).toBe(1);
    expect(scottieEventParticipant.seedNumber).toBe(1);
    expect(scottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);
  });

  // #118 — an admin who links a tournament for scores only keeps its name, schedule, rounds and
  // status: the provider's field-detail sync loads the field and refreshes the field size only.
  it('loads the provider field into a SCORES_ONLY event without overwriting its admin-authored header, schedule or status', async () => {
    const prisma = getPrisma();
    const adapter = new MockContestFeedAdapter(mockProvider.baseUrl);
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const detail = await adapter.getEventDetails(eventExternalId);
    expect(detail).not.toBeNull();

    const adminStart = new Date('2026-04-08T13:30:00.000Z');
    const linked = await linkedProviderEvent(prisma, {
      providerId,
      externalId: eventExternalId,
      name: 'Admin Spring Classic',
      startDate: adminStart,
    });
    await prisma.sportEvent.update({
      where: { id: linked.id },
      data: { syncScope: 'SCORES_ONLY', rounds: 4, venue: 'Admin Links' },
    });
    expect(expectDefined(detail).startDate.toISOString()).not.toBe(adminStart.toISOString());
    expect(expectDefined(detail).name).not.toBe('Admin Spring Classic');

    const result = (await persistence.persistEventDetailWithDiagnostics(expectDefined(detail))).value;

    expect(result.sportEventParticipantsPersisted).toBe(expectDefined(detail).participants.length);
    const after = await prisma.sportEvent.findUniqueOrThrow({ where: { id: linked.id } });
    expect(after).toMatchObject({
      name: 'Admin Spring Classic',
      venue: 'Admin Links',
      startDate: adminStart,
      rounds: 4,
      status: linked.status,
      syncScope: 'SCORES_ONLY',
      participantCount: expectDefined(detail).participants.length,
    });
    await expect(prisma.sportEventParticipant.count({ where: { sportEventId: linked.id } }))
      .resolves.toBe(expectDefined(detail).participants.length);
  });

  it('pool-master-rop.68.1.7 verifies manual and scheduled Golf event sync workflow with scoped payload diagnostics, and no schedule sync', async () => {
    const prisma = getPrisma();
    const provider = new MockContestFeedAdapter(mockProvider.baseUrl);
    const registry = new ProviderRegistry();
    registry.register(Sport.GOLF, provider, 'PRIMARY');
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    // A run's event is the SportEvent it links (#2040), found as the app finds it.
    const syncRunLedger = new ProviderSyncRunLedger(new PrismaProviderSyncRunRepository(getAppPrisma()), undefined, new PrismaSportEventRepository(getAppPrisma()));
    const eventReader = createScheduledEventReader({ prisma: getAppPrisma(), registry });
    const configReader = {
      getConfig: async () => syncVerificationConfig,
    };
    const scheduler = new IngestionScheduler(registry, {
      onEventDetail: (detail) => persistence.persistEventDetailWithDiagnostics(detail),
      onLiveScores: async () => emptyLiveScorePersistenceResult(),
    }, undefined, {
      configReader,
      eventReader,
      now: () => syncVerificationNow,
      syncRunLedger,
    });
    const rootAdmin = await createTestUser({
      displayName: 'Golf Sync Verification Root Admin',
      isRootAdmin: true,
    });
    const backgroundJobs = integrationBackgroundJobs();
    const providerService = new IngestionService({
      registry,
      sportEvents: new PrismaSportEventRepository(getAppPrisma()),
      syncRuns: new PrismaProviderSyncRunRepository(getAppPrisma()),
      scheduler,
      sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
      providerSettings: { all: () => [], bySourceId: () => undefined },
      webhooks: { isOn: () => false, isSecretSet: () => false },
      jobHistory: new PrismaBackgroundJobRepository(getAppPrisma()),
      syncRunLedger,
      jobs: backgroundJobs.queue,
    });
    backgroundJobs.runWith({ MANUAL_EVENT_SYNC: (payload, context) => providerService.runManualEventSync(payload, context) });

    const linked = await linkProviderGolfEvents(new Date('2026-04-01T00:00:00.000Z'), new Date('2026-06-30T23:59:59.999Z'));
    expect(linked).toBeGreaterThan(0);

    const eligibleEvents = await eventReader.listEventsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      from: syncVerificationNow,
      to: new Date(syncVerificationNow.getTime() + 7 * 24 * 60 * 60 * 1000),
      now: syncVerificationNow,
    });
    expect(eligibleEvents).toEqual([
      { providerId: 'balldontlie', externalId: 'golf-genesis-scottish-open-2026' },
    ]);

    const manualField = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    const firstFieldRuns = await waitForProviderSyncRuns(manualField.syncRuns.map((run) => run.id));
    expect(firstFieldRuns[0].detailsJson).toEqual(expect.objectContaining({
      writeDiagnostics: expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({
            entityType: 'SportEventParticipant',
            externalId: eventExternalId,
            participantExternalId: 'golfer-01',
          }),
        ]),
      }),
    }));

    const manualFieldRefresh = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    const fieldRuns = await waitForProviderSyncRuns(manualFieldRefresh.syncRuns.map((run) => run.id));
    expect(fieldRuns[0].payloadJson).toEqual(expect.objectContaining({ requestedFeed: 'EVENTPARTICIPANTS' }));
    expect(fieldRuns[0].detailsJson).toEqual(expect.objectContaining({
      jobPayload: expect.objectContaining({ status: 'COMPLETED' }),
      // A refresh of an unchanged field counts all 80 golfers and stores none of their rows (#1174).
      writeDiagnostics: {
        summary: { total: 80, unchanged: 80, created: 0, updated: 0, deleted: 0 },
        rows: [],
      },
    }));

    scheduler.start();
    let scheduledRuns: Awaited<ReturnType<typeof waitForScheduledProviderSyncRuns>>;
    try {
      scheduledRuns = await waitForScheduledProviderSyncRuns(BALLDONTLIE_TEST_PROVIDER_ID, 1);
    } finally {
      scheduler.stop();
    }

    const scottieEventParticipant = await findEventParticipantByExternalIds({
      providerId,
      eventExternalId,
      participantExternalId: 'golfer-01',
    });
    expect(scottieEventParticipant.ranking).toBe(1);
    expect(scottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);
    const scheduledScottieEventParticipant = await findEventParticipantByExternalIds({
      providerId,
      eventExternalId: 'golf-genesis-scottish-open-2026',
      participantExternalId: 'golfer-01',
    });
    expect(scheduledScottieEventParticipant.ranking).toBe(1);
    expect(scheduledScottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);

    const scheduledRunPayloads = scheduledRuns.map((run) => readStoredSyncRunPayload(run.payloadJson));
    expect(scheduledRuns.map((run) => run.sportEvent?.externalId).filter((id): id is string => Boolean(id))).toEqual([
      'golf-genesis-scottish-open-2026',
    ]);
    expect(scheduledRunPayloads.map((payload) => String(payload?.requestedFeed))).toEqual([
      'EVENTPARTICIPANTS',
    ]);

    const scheduledPayloadPaths = scheduledRuns
      .flatMap((run) => providerPayloadPaths(run.detailsJson));
    expect(scheduledPayloadPaths).toEqual(expect.arrayContaining([
      '/v1/scenarios',
      '/v1/scenarios/golf-major-2026/events',
      '/v1/scenarios/golf-major-2026/events/golf-genesis-scottish-open-2026/detail',
    ]));

    const persistedProviderEvents = await prisma.sportEvent.findMany({
      where: { providerId },
      select: { eventSeries: { select: { sportLeague: { select: { sport: { select: { sport: true } } } } } } },
    });
    expect([...new Set(persistedProviderEvents.map((row) => row.eventSeries.sportLeague.sport.sport))]).toEqual(['GOLF']);
    // #205 — each run carries the job it executed (`jobPayload`); the separate job table is gone.
    expect(scheduledRuns.map((run) => readStoredSyncRunDetails(run.detailsJson)?.jobPayload)).toEqual([
      expect.objectContaining({ jobType: 'EVENT_PARTICIPANTS_SYNC' }),
    ]);
  });

  it('pool-master-eux.8: verifies Golf live scoring through leaderboard movement and completed settlement', async () => {
    const prisma = getPrisma();
    const provider = new MockContestFeedAdapter(mockProvider.baseUrl);
    const registry = new ProviderRegistry();
    registry.register(Sport.GOLF, provider, 'PRIMARY');
    const settlement = createContestSettlementService(getAppPrisma(), undefined, { domainEvents: testDomainEvents() });
    // One queue and one runner over the job table, as the app has: two runners here would each
    // claim the other's jobs and fail them as unexpected.
    const backgroundJobs = integrationBackgroundJobs();
    const eventLifecycleService = createEventLifecycleService(getAppPrisma(), {
      domainEvents: testDomainEvents({ queue: backgroundJobs.queue }),
      contestSettlement: settlement,
    });
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    // A run's event is the SportEvent it links (#2040), found as the app finds it.
    const syncRunLedger = new ProviderSyncRunLedger(new PrismaProviderSyncRunRepository(getAppPrisma()), undefined, new PrismaSportEventRepository(getAppPrisma()));
    const eventReader = createScheduledEventReader({ prisma: getAppPrisma(), registry });
    const scheduler = new IngestionScheduler(registry, {
      onEventDetail: (detail) => persistence.persistEventDetailWithDiagnostics(detail),
      onLiveScores: async (result, providerIdForResult) =>
        publishLiveScoreUpdate(result, { contestActivation: NO_CONTEST_ACTIVATION, prisma, providerId: providerIdForResult, domainEvents: testDomainEvents(), scoringFamilyForEvent, findings: integrationSyncFindings() }),
    }, undefined, {
      eventReader,
      syncRunLedger,
    });
    const rootAdmin = await createTestUser({
      displayName: 'Golf Live E2E Root Admin',
      isRootAdmin: true,
    });
    const providerService = new IngestionService({
      registry,
      sportEvents: new PrismaSportEventRepository(getAppPrisma()),
      syncRuns: new PrismaProviderSyncRunRepository(getAppPrisma()),
      scheduler,
      sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
      providerSettings: { all: () => [], bySourceId: () => undefined },
      webhooks: { isOn: () => false, isSecretSet: () => false },
      jobHistory: new PrismaBackgroundJobRepository(getAppPrisma()),
      syncRunLedger,
      jobs: backgroundJobs.queue,
    });
    // Completing the event queues the job that settles its contests (#1448); this runs it.
    const settleRunner = backgroundJobs.runWith({
      MANUAL_EVENT_SYNC: (payload, context) => providerService.runManualEventSync(payload, context),
      SETTLE_SPORT_EVENT_CONTESTS: (payload) => eventLifecycleService.settleFinishedEventContests(payload),
    });

    await linkProviderGolfEvents(new Date('2026-04-01T00:00:00.000Z'), new Date('2026-06-30T23:59:59.999Z'));

    provider.pinEventState(eventExternalId, 'locked');
    const field = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(field.syncRuns.map((run) => run.id));

    const event = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
    });
    const selectedParticipants = await loadSportEventParticipants([
      'golfer-01',
      'golfer-02',
      'golfer-03',
      'golfer-04',
      'golfer-05',
      'golfer-06',
    ]);
    const golfer01SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-01');
    const golfer02SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-02');
    const golfer03SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-03');
    const golfer04SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-04');
    const golfer05SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-05');
    const golfer06SportEventParticipantId = requiredSportEventParticipantId(selectedParticipants, 'golfer-06');
    const { directContest, directEntries } =
      await createGolfLiveVerificationContests({
        ownerUserId: rootAdmin.user.id,
        sportEventId: event.id,
        directPicks: {
          leader: [
            golfer01SportEventParticipantId,
            golfer02SportEventParticipantId,
            golfer05SportEventParticipantId,
          ],
          chaser: [
            golfer03SportEventParticipantId,
            golfer04SportEventParticipantId,
            golfer06SportEventParticipantId,
          ],
        },
      });

    const beforeLive = await readGolfLeaderboard(directContest.id, rootAdmin.headers);
    expect(beforeLive.entries.every((entry) => entry.totalScore === null)).toBe(true);
    expect(beforeLive.entries.every((entry) => entry.scoredPickCount === 0)).toBe(true);

    // Live scores are accepted only while the event is in progress, and the provider never
    // moves its status (#435): the admin starts it.
    await eventLifecycleService.applySportEventStatusTransition({
      sportEventId: event.id,
      toStatus: 'IN_PROGRESS',
      actor: { type: 'ROOT_ADMIN' },
    });

    provider.pinEventState(eventExternalId, 'golf-r2-complete');
    const r2Complete = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTLIVESCORES'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(r2Complete.syncRuns.map((run) => run.id));

    const leaderboardAfterR2 = await readGolfLeaderboard(directContest.id, rootAdmin.headers);
    const leaderAfterR2 = leaderboardAfterR2.entries.find((entry) => entry.entryId === directEntries.leader.id);
    expect(leaderAfterR2?.totalScore).not.toBeNull();
    expect(leaderAfterR2?.scoredPickCount).toBe(3);
    expect(leaderAfterR2?.countingPickLimit).toBe(2);
    expect(leaderAfterR2?.picks.filter((pick) => pick.isCounting)).toHaveLength(2);
    expect(leaderAfterR2?.picks.filter((pick) => pick.isDropped)).toHaveLength(1);
    const golfer01AfterR2 = fieldScore(leaderboardAfterR2, golfer01SportEventParticipantId);
    expect(golfer01AfterR2).not.toBeNull();
    await expect(prisma.contestEntryStanding.count({
      where: { contestId: { in: [directContest.id] } },
    })).resolves.toBe(0);
    await expect(prisma.contest.findMany({
      where: { id: { in: [directContest.id] } },
      select: { status: true },
    })).resolves.toEqual([
      { status: 'ACTIVE' },
    ]);

    provider.pinEventState(eventExternalId, 'golf-correction');
    const corrected = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTLIVESCORES'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(corrected.syncRuns.map((run) => run.id));

    const leaderboardAfterCorrection = await readGolfLeaderboard(directContest.id, rootAdmin.headers);
    const leaderAfterCorrection = leaderboardAfterCorrection.entries.find((entry) => entry.entryId === directEntries.leader.id);
    const golfer01AfterCorrection = fieldScore(leaderboardAfterCorrection, golfer01SportEventParticipantId);
    expect(golfer01AfterCorrection).toBe((golfer01AfterR2 ?? 0) - 2);
    expect(leaderAfterCorrection?.picks.filter((pick) => pick.isCounting)).toHaveLength(2);
    expect(leaderAfterCorrection?.picks.filter((pick) => pick.isDropped)).toHaveLength(1);

    provider.pinEventState(eventExternalId, 'golf-completed');
    const finalLive = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTLIVESCORES'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(finalLive.syncRuns.map((run) => run.id));
    await expect(prisma.contestEntryStanding.count({
      where: { contestId: { in: [directContest.id] } },
    })).resolves.toBe(0);

    // #435 — the provider never moves an event's status; the admin (or the lifecycle
    // scheduler) does, and completing the event settles its contests.
    await eventLifecycleService.applySportEventStatusTransition({
      sportEventId: event.id,
      toStatus: 'COMPLETED',
      actor: { type: 'ROOT_ADMIN' },
    });
    await settleRunner.drain();

    await expect(prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
      select: { status: true },
    })).resolves.toEqual({ status: 'COMPLETED' });
    await expect(prisma.contest.findMany({
      where: { id: { in: [directContest.id] } },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    })).resolves.toEqual([
      expect.objectContaining({ status: 'COMPLETED' }),
    ]);
    await expect(prisma.contestEntryStanding.count({
      where: {
        contestEntryId: {
          in: [
            directEntries.leader.id,
            directEntries.chaser.id,
          ],
        },
      },
    })).resolves.toBe(2);
    // #261 — this and the check after the rerun asserted one `contest.completed` event. The
    // outcome it stood for, asserted directly: the contest is settled exactly once, so the
    // rerun below leaves the contest and its standings untouched. `updatedAt` is the witness —
    // `settledAt` comes from the event's end date and would read the same after a resettle.
    const readSettlement = async () => ({
      contest: await prisma.contest.findUniqueOrThrow({
        where: { id: directContest.id },
        select: { status: true, endsAt: true },
      }),
      standings: await prisma.contestEntryStanding.findMany({
        where: { contestEntryId: { in: [directEntries.leader.id, directEntries.chaser.id] } },
        select: { contestEntryId: true, settledAt: true, updatedAt: true },
        orderBy: { contestEntryId: 'asc' },
      }),
    });
    const settledOnce = await readSettlement();

    const completedLiveCandidates = await eventReader.listLiveScoreEvents({
      sport: Sport.GOLF,
      now: new Date('2026-05-31T23:00:00.000Z'),
    });
    expect(completedLiveCandidates.map((event) => event.externalId)).not.toContain(eventExternalId);

    provider.pinEventState(eventExternalId, 'golf-completed');
    const rerunCompletedDetail = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        providerId: 'balldontlie',
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(rerunCompletedDetail.syncRuns.map((run) => run.id));
    await expect(prisma.contestEntryStanding.count({
      where: {
        contestEntryId: {
          in: [
            directEntries.leader.id,
            directEntries.chaser.id,
          ],
        },
      },
    })).resolves.toBe(2);
    await expect(readSettlement()).resolves.toEqual(settledOnce);
  });

  it('an admin-linked event has no field and the provider schedule is never pulled until an event field sync loads contest-ready event detail', async () => {
    const prisma = getPrisma();
    const provider = new MockContestFeedAdapter(mockProvider.baseUrl);
    const registry = new ProviderRegistry();
    const getUpcomingEventsSpy = jest.spyOn(provider, 'getUpcomingEvents');
    const getEventDetailsSpy = jest.spyOn(provider, 'getEventDetails');
    registry.register(Sport.GOLF, provider, 'PRIMARY');

    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const scheduler = new IngestionScheduler(registry, {
      onEventDetail: (detail) => persistence.persistEventDetailWithDiagnostics(detail),
      onLiveScores: async () => emptyLiveScorePersistenceResult(),
    });

    await linkProviderGolfEvents(new Date('2026-04-01T00:00:00.000Z'), new Date('2026-04-30T23:59:59.999Z'));

    const linkedEvent = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
    });
    await expect(prisma.sportEventParticipant.count({
      where: {
        sportEventId: linkedEvent.id,
      },
    })).resolves.toBe(0);

    // #205 deleted the one-off re-ingest; the event field sync (`submitEventSync`) is how an
    // event's field is loaded on demand.
    const [fieldJob] = await scheduler.runEventSync({
      sport: Sport.GOLF,
      providerId: 'balldontlie',
      eventId: eventExternalId,
      feeds: ['EVENTPARTICIPANTS'],
    });

    expect(fieldJob.status).toBe('COMPLETED');
    expect(getEventDetailsSpy).toHaveBeenCalledWith(eventExternalId);
    expect(getUpcomingEventsSpy).not.toHaveBeenCalled();

    const hydratedEventParticipantCount = await prisma.sportEventParticipant.count({
      where: {
        sportEventId: linkedEvent.id,
      },
    });
    expect(hydratedEventParticipantCount).toBeGreaterThan(0);
  });
});
