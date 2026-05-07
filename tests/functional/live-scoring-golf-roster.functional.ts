import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  createContest,
  createLeague,
  enterContest,
  getStandings,
  ingestEventScores,
  loginUser,
  registerUser,
} from '@poolmaster/shared/generated/hey-api';
import { createClient, createConfig, type Client } from '@poolmaster/shared/generated/hey-api/client';
import {
  ContestFormat,
  ContestStatus,
  ParticipantType,
  ScoringEngine,
  SelectionType,
  Sport,
  TierAssignmentMethod,
} from '@poolmaster/shared/domain';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import { buildApp as buildCoreApiApp } from '../../packages/core-api/src/index';
import {
  startMockContestFeedProvider,
  type RunningMockContestFeedProvider,
} from '../integration/mock-contest-feed-provider-helper';
import {
  cleanupFunctionalData,
  createFunctionalEmail,
  disconnectFunctionalPrisma,
  getFunctionalPrisma,
} from './setup';

interface LocalApiHarness {
  api: FastifyInstance;
  apiBaseUrl: string;
  mockProvider: RunningMockContestFeedProvider;
  scenarioDir: string;
  restoreEnv: () => void;
}

interface LocalUser {
  client: Client;
  email: string;
  password: string;
  token: string;
  userId: string;
}

interface SeededGolfEvent {
  externalEventId: string;
  sportEventId: string;
  sportId: string;
  participants: Array<{
    externalId: string;
    participantId: string;
    sportEventParticipantId: string;
    strokes: number;
    scoreToPar: number;
  }>;
}

interface StandingsUpdatedEvent {
  type: 'standings.updated';
  contestId: string;
  standings: Array<{
    entryId: string;
    rank: number;
    totalScore: number;
    isTied: boolean;
  }>;
}

const providerId = 'mock-contest-feed';
const fixtureSportIds: string[] = [];
const fixtureParticipantIds: string[] = [];
const fixtureSportEventIds: string[] = [];
const fixtureSportEventParticipantIds: string[] = [];

afterEach(async () => {
  await cleanupFunctionalData();
  await cleanupLiveScoringFixtureArtifacts();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: pool-master-rop.78.12 live golf-roster scoring', () => {
  // pool-master-rop.15 — folds the missing end-to-end LiveScoreResult-to-standings regression detector.
  it('persists mock-feed golf rounds, scores picked rosters, reranks standings, and emits bus events', async () => {
    const eventExternalId = `rop-78-12-event-${randomUUID()}`;
    const harness = await startLocalApiHarness(eventExternalId);
    const prisma = getFunctionalPrisma();
    const persistedEvents: LiveScorePersistedEvent[] = [];
    const standingsEvents: StandingsUpdatedEvent[] = [];

    eventBus.subscribe<LiveScorePersistedEvent>('live_score.persisted', async (event) => {
      persistedEvents.push(event);
    });
    eventBus.subscribe<StandingsUpdatedEvent>('standings.updated', async (event) => {
      standingsEvents.push(event);
    });

    try {
      const commissioner = await registerLocalUser(harness.apiBaseUrl);
      const leagueResponse = await createLeague({
        client: commissioner.client,
        body: {
          name: 'Live Scoring Golf Roster League',
          leagueCode: `LS${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
        },
      });

      if (!leagueResponse.data) {
        throw new Error('Builder: createLeague failed for live-scoring functional fixture');
      }

      await prisma.user.update({
        where: { id: commissioner.userId },
        data: { isRootAdmin: true },
      });
      const rootAdmin = await loginLocalUser(
        harness.apiBaseUrl,
        commissioner.email,
        commissioner.password,
      );

      const golfEvent = await seedGolfRosterEvent(eventExternalId);
      const contestResponse = await createContest({
        client: commissioner.client,
        path: { id: leagueResponse.data.league.id },
        body: {
          name: 'Live Scoring Golf Roster Contest',
          contestFormat: ContestFormat.ROSTER,
          selectionType: SelectionType.TIERED,
          scoringEngine: ScoringEngine.STROKE_PLAY,
          contestConfiguration: {
            rounds: 1,
            tierAssignmentMethod: TierAssignmentMethod.ODDS,
            tierConfig: [
              {
                tierId: 'tier-1',
                tierName: 'Tier 1',
                tierNumber: 1,
                picksFromTier: 2,
                participantIds: [],
              },
            ],
          },
        },
      });

      if (!contestResponse.data) {
        throw new Error('Builder: createContest failed for live-scoring functional fixture');
      }

      const contestId = contestResponse.data.contest.id;
      await prisma.contest.update({
        where: { id: contestId },
        data: {
          sportEventId: golfEvent.sportEventId,
          status: ContestStatus.OPEN,
        },
      });
      const firstEntry = await enterContest({
        client: commissioner.client,
        path: { contestId },
      });
      if (!firstEntry.data) {
        throw new Error('Builder: enterContest failed for live-scoring functional fixture');
      }
      const firstEntryId = firstEntry.data?.entry.id as string;
      const firstEntryRow = await prisma.contestEntry.findUniqueOrThrow({
        where: { id: firstEntryId },
        select: { squadId: true },
      });
      const secondEntry = await prisma.contestEntry.create({
        data: {
          contestId,
          squadId: firstEntryRow.squadId,
          entryNumber: 2,
          name: 'Live Scoring Entry 2',
        },
      });
      const secondEntryId = secondEntry.id;

      await prisma.contestEntryPick.createMany({
        data: [
          {
            entryId: firstEntryId,
            sportEventParticipantId: golfEvent.participants[0].sportEventParticipantId,
            contestFormat: 'ROSTER',
          },
          {
            entryId: firstEntryId,
            sportEventParticipantId: golfEvent.participants[1].sportEventParticipantId,
            contestFormat: 'ROSTER',
          },
          {
            entryId: secondEntryId,
            sportEventParticipantId: golfEvent.participants[2].sportEventParticipantId,
            contestFormat: 'ROSTER',
          },
          {
            entryId: secondEntryId,
            sportEventParticipantId: golfEvent.participants[3].sportEventParticipantId,
            contestFormat: 'ROSTER',
          },
        ],
      });
      await prisma.contest.update({
        where: { id: contestId },
        data: { status: ContestStatus.ACTIVE },
      });

      const ingestResponse = await ingestEventScores({
        client: rootAdmin.client,
        path: {
          sport: Sport.GOLF,
          eventId: eventExternalId,
        },
      });

      expect(ingestResponse.data?.job).toEqual(
        expect.objectContaining({
          jobType: 'EVENT_LIVE_SCORES_SYNC',
          providerId,
          sport: Sport.GOLF,
          eventExternalId,
          status: 'COMPLETED',
          recordsProcessed: 4,
          errors: 0,
        }),
      );

      const golfRounds = await prisma.sportEventParticipantGolfRound.findMany({
        where: {
          sportEventParticipantId: {
            in: golfEvent.participants.map((participant) => participant.sportEventParticipantId),
          },
        },
        orderBy: [{ scoreToPar: 'asc' }, { strokes: 'asc' }],
      });
      expect(golfRounds).toHaveLength(4);
      expect(golfRounds.map((round) => ({
        round: round.round,
        strokes: round.strokes,
        scoreToPar: round.scoreToPar,
        status: round.status,
      }))).toEqual([
        { round: 1, strokes: 68, scoreToPar: -4, status: 'COMPLETED' },
        { round: 1, strokes: 71, scoreToPar: -1, status: 'COMPLETED' },
        { round: 1, strokes: 73, scoreToPar: 1, status: 'COMPLETED' },
        { round: 1, strokes: 75, scoreToPar: 3, status: 'COMPLETED' },
      ]);

      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0]).toEqual(
        expect.objectContaining({
          type: 'live_score.persisted',
          category: 'GOLF',
          providerId,
          sportEventId: golfEvent.sportEventId,
          updatesPersisted: 4,
        }),
      );

      const contributions = await prisma.contestEntryPickGolfRosterContribution.findMany({
        where: {
          pick: {
            entryId: {
              in: [firstEntryId, secondEntryId],
            },
          },
        },
        include: {
          pick: true,
        },
        orderBy: [{ scoreToPar: 'asc' }, { strokes: 'asc' }],
      });
      expect(contributions.map((row) => ({
        entryId: row.pick.entryId,
        round: row.round,
        strokes: row.strokes,
        scoreToPar: row.scoreToPar,
        contribution: Number(row.contribution),
      }))).toEqual([
        { entryId: firstEntryId, round: 1, strokes: 68, scoreToPar: -4, contribution: -4 },
        { entryId: secondEntryId, round: 1, strokes: 71, scoreToPar: -1, contribution: -1 },
        { entryId: firstEntryId, round: 1, strokes: 73, scoreToPar: 1, contribution: 1 },
        { entryId: secondEntryId, round: 1, strokes: 75, scoreToPar: 3, contribution: 3 },
      ]);

      const entries = await prisma.contestEntry.findMany({
        where: {
          id: {
            in: [firstEntryId, secondEntryId],
          },
        },
        orderBy: { standingsPosition: 'asc' },
      });
      expect(entries.map((entry) => ({
        id: entry.id,
        totalScore: entry.totalScore,
        standingsPosition: entry.standingsPosition,
      }))).toEqual([
        { id: firstEntryId, totalScore: -3, standingsPosition: 1 },
        { id: secondEntryId, totalScore: 2, standingsPosition: 2 },
      ]);

      expect(standingsEvents).toHaveLength(1);
      expect(standingsEvents[0]).toEqual(
        expect.objectContaining({
          type: 'standings.updated',
          contestId,
          standings: [
            { entryId: firstEntryId, rank: 1, totalScore: -3, isTied: false },
            { entryId: secondEntryId, rank: 2, totalScore: 2, isTied: false },
          ],
        }),
      );

      const standingsResponse = await getStandings({
        client: commissioner.client,
        path: { contestId },
        query: {
          page: '1',
          pageSize: '10',
          sortBy: 'rank',
        },
      });
      expect(standingsResponse.data).toBeDefined();
      expect(standingsResponse.data?.contestId).toBe(contestId);
      expect(standingsResponse.data?.total).toBe(2);
      expect(standingsResponse.data?.standings.map((standing) => ({
        entryId: standing.entryId,
        rank: standing.rank,
        totalScore: standing.totalScore,
      }))).toEqual([
        { entryId: firstEntryId, rank: 1, totalScore: -3 },
        { entryId: secondEntryId, rank: 2, totalScore: 2 },
      ]);
    } finally {
      await harness.api.close();
      await harness.mockProvider.close();
      harness.restoreEnv();
      await rm(harness.scenarioDir, { recursive: true, force: true });
    }
  });
});

async function startLocalApiHarness(eventExternalId: string): Promise<LocalApiHarness> {
  const previousEnv = {
    AUTO_START_SCHEDULER: process.env.AUTO_START_SCHEDULER,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SCENARIO_DIR: process.env.SCENARIO_DIR,
    SPORT_DATA_DEFAULT_PROVIDER: process.env.SPORT_DATA_DEFAULT_PROVIDER,
    SPORT_DATA_PROVIDER_BINDINGS_JSON: process.env.SPORT_DATA_PROVIDER_BINDINGS_JSON,
  };
  const scenarioDir = await mkdtemp(path.join(tmpdir(), 'poolmaster-rop-78-12-'));
  await writeLiveScoringScenario(scenarioDir, eventExternalId);
  process.env.SCENARIO_DIR = scenarioDir;
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

  const mockProvider = await startMockContestFeedProvider({
    routes: {
      scenarioStoreOptions: {
        includeRelativeTodayGolfScenario: false,
      },
    },
  });

  process.env.AUTO_START_SCHEDULER = 'false';
  process.env.SPORT_DATA_DEFAULT_PROVIDER = providerId;
  process.env.SPORT_DATA_PROVIDER_BINDINGS_JSON = JSON.stringify({
    providers: {
      [providerId]: {
        baseUrl: mockProvider.baseUrl,
      },
    },
  });

  const api = buildCoreApiApp();
  await api.ready();
  await api.listen({ host: '127.0.0.1', port: 0 });
  const address = api.server.address();
  if (!address || typeof address === 'string') {
    await api.close();
    await mockProvider.close();
    throw new Error('Local live-scoring API harness did not bind to an ephemeral port');
  }

  return {
    api,
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    mockProvider,
    scenarioDir,
    restoreEnv: () => {
      restoreEnvValue('AUTO_START_SCHEDULER', previousEnv.AUTO_START_SCHEDULER);
      restoreEnvValue('LOG_LEVEL', previousEnv.LOG_LEVEL);
      restoreEnvValue('SCENARIO_DIR', previousEnv.SCENARIO_DIR);
      restoreEnvValue('SPORT_DATA_DEFAULT_PROVIDER', previousEnv.SPORT_DATA_DEFAULT_PROVIDER);
      restoreEnvValue('SPORT_DATA_PROVIDER_BINDINGS_JSON', previousEnv.SPORT_DATA_PROVIDER_BINDINGS_JSON);
    },
  };
}

async function writeLiveScoringScenario(
  scenarioDir: string,
  eventExternalId: string,
): Promise<void> {
  const contestants = [
    { contestantId: 'golfer-01', name: 'Scottie Scheffler', seed: 1, odds: 8.5, ranking: 1 },
    { contestantId: 'golfer-02', name: 'Rory McIlroy', seed: 2, odds: 9.5, ranking: 2 },
    { contestantId: 'golfer-03', name: 'Xander Schauffele', seed: 3, odds: 11.5, ranking: 3 },
    { contestantId: 'golfer-04', name: 'Collin Morikawa', seed: 4, odds: 13.5, ranking: 4 },
  ];
  const scenario = {
    scenarioId: 'rop-78-12-live-scoring',
    sport: 'GOLF',
    provider: providerId,
    description: 'rop.78.12 functional live-scoring golf-roster fixture',
    season: {
      seasonId: 'rop-78-12-golf-season',
      name: 'rop.78.12 Golf Season',
      year: 2026,
      startsAt: '2026-04-01T00:00:00.000Z',
      endsAt: '2026-04-30T23:59:59.999Z',
    },
    events: [
      {
        eventId: eventExternalId,
        name: 'rop.78.12 Live Scoring Open',
        status: 'in_progress',
        schedule: {
          startsAt: '2026-04-10T12:00:00.000Z',
          endsAt: '2026-04-13T23:00:00.000Z',
          releaseAt: '2026-04-03T12:00:00.000Z',
          fieldLocksAt: '2026-04-10T11:55:00.000Z',
        },
        venue: {
          name: 'Functional Links',
          city: 'Augusta',
          region: 'GA',
          countryCode: 'US',
          timeZone: 'America/New_York',
        },
        field: {
          asOf: '2026-04-03T12:00:00.000Z',
          status: 'locked',
          contestants,
        },
        feeds: {
          odds: {
            asOf: '2026-04-03T12:00:00.000Z',
            contestants: contestants.map((contestant) => ({
              contestantId: contestant.contestantId,
              odds: contestant.odds,
            })),
          },
          rankings: {
            asOf: '2026-04-03T14:00:00.000Z',
            contestants: contestants.map((contestant) => ({
              contestantId: contestant.contestantId,
              ranking: contestant.ranking,
            })),
          },
          results: {
            asOf: '2026-04-10T19:00:00.000Z',
            contestants: [
              { contestantId: 'golfer-01', strokes: 68, score: -4, result: 'pending' },
              { contestantId: 'golfer-02', strokes: 73, score: 1, result: 'pending' },
              { contestantId: 'golfer-03', strokes: 71, score: -1, result: 'pending' },
              { contestantId: 'golfer-04', strokes: 75, score: 3, result: 'pending' },
            ],
          },
        },
      },
    ],
  };

  await writeFile(
    path.join(scenarioDir, 'rop-78-12-live-scoring.json'),
    JSON.stringify(scenario, null, 2),
  );
}

async function registerLocalUser(apiBaseUrl: string): Promise<LocalUser> {
  const client = createSdkClient(apiBaseUrl);
  const password = 'FuncTest123!';
  const email = createFunctionalEmail('live-scoring');
  const registration = await registerUser({
    client,
    body: {
      username: email,
      email,
      password,
      firstName: 'Live',
      lastName: 'Scoring',
    },
  });

  if (!registration.data) {
    throw new Error('Builder: registerUser failed for live-scoring functional fixture');
  }

  return loginLocalUser(apiBaseUrl, email, password, registration.data.user.id);
}

async function loginLocalUser(
  apiBaseUrl: string,
  email: string,
  password: string,
  knownUserId?: string,
): Promise<LocalUser> {
  const login = await loginUser({
    client: createSdkClient(apiBaseUrl),
    body: {
      identifier: email,
      password,
    },
  });

  if (!login.data) {
    throw new Error('Builder: loginUser failed for live-scoring functional fixture');
  }

  return {
    client: createSdkClient(apiBaseUrl, login.data.tokens.accessToken),
    email,
    password,
    token: login.data.tokens.accessToken,
    userId: knownUserId ?? login.data.user.id,
  };
}

function createSdkClient(apiBaseUrl: string, accessToken?: string): Client {
  const client = createClient(createConfig({ baseUrl: apiBaseUrl }));
  if (accessToken) {
    client.interceptors.request.use((request: Request) => {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
      return request;
    });
  }
  return client;
}

async function seedGolfRosterEvent(externalEventId: string): Promise<SeededGolfEvent> {
  const prisma = getFunctionalPrisma();
  const sport = await prisma.sport.create({
    data: {
      name: `rop-78-12-golf-${randomUUID().slice(0, 8)}`,
      participantType: ParticipantType.INDIVIDUAL,
    },
  });
  fixtureSportIds.push(sport.id);

  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: externalEventId,
      providerId,
      sport: Sport.GOLF,
      name: 'rop.78.12 Live Scoring Open',
      startDate: new Date('2026-04-10T12:00:00.000Z'),
      endDate: new Date('2026-04-13T23:00:00.000Z'),
      releaseAt: new Date('2026-04-03T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-10T11:55:00.000Z'),
      status: 'IN_PROGRESS',
      participantCount: 4,
    },
  });
  fixtureSportEventIds.push(sportEvent.id);

  const inputParticipants = [
    { externalId: 'golfer-01', name: 'Scottie Scheffler', strokes: 68, scoreToPar: -4 },
    { externalId: 'golfer-02', name: 'Rory McIlroy', strokes: 73, scoreToPar: 1 },
    { externalId: 'golfer-03', name: 'Xander Schauffele', strokes: 71, scoreToPar: -1 },
    { externalId: 'golfer-04', name: 'Collin Morikawa', strokes: 75, scoreToPar: 3 },
  ];
  const participants: SeededGolfEvent['participants'] = [];

  for (const input of inputParticipants) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: input.name,
        participantType: ParticipantType.INDIVIDUAL,
        externalId: input.externalId,
        externalIds: { [providerId]: input.externalId },
        position: 'GOLFER',
      },
    });
    fixtureParticipantIds.push(participant.id);
    await prisma.participantProviderMapping.create({
      data: {
        participantId: participant.id,
        providerId,
        externalId: input.externalId,
      },
    });
    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    fixtureSportEventParticipantIds.push(sportEventParticipant.id);
    participants.push({
      externalId: input.externalId,
      participantId: participant.id,
      sportEventParticipantId: sportEventParticipant.id,
      strokes: input.strokes,
      scoreToPar: input.scoreToPar,
    });
  }

  return {
    externalEventId,
    sportEventId: sportEvent.id,
    sportId: sport.id,
    participants,
  };
}

async function cleanupLiveScoringFixtureArtifacts(): Promise<void> {
  const prisma = getFunctionalPrisma();
  if (fixtureSportEventParticipantIds.length > 0) {
    await prisma.sportEventParticipantGolfRound.deleteMany({
      where: {
        sportEventParticipantId: {
          in: fixtureSportEventParticipantIds,
        },
      },
    });
    await prisma.sportEventParticipantValuation.deleteMany({
      where: {
        sportEventParticipantId: {
          in: fixtureSportEventParticipantIds,
        },
      },
    });
    await prisma.sportEventParticipant.deleteMany({
      where: {
        id: {
          in: fixtureSportEventParticipantIds,
        },
      },
    });
    fixtureSportEventParticipantIds.length = 0;
  }
  if (fixtureSportEventIds.length > 0) {
    await prisma.sportEvent.deleteMany({
      where: {
        id: {
          in: fixtureSportEventIds,
        },
      },
    });
    fixtureSportEventIds.length = 0;
  }
  if (fixtureParticipantIds.length > 0) {
    await prisma.participantProviderMapping.deleteMany({
      where: {
        participantId: {
          in: fixtureParticipantIds,
        },
      },
    });
    await prisma.participant.deleteMany({
      where: {
        id: {
          in: fixtureParticipantIds,
        },
      },
    });
    fixtureParticipantIds.length = 0;
  }
  if (fixtureSportIds.length > 0) {
    await prisma.sport.deleteMany({
      where: {
        id: {
          in: fixtureSportIds,
        },
      },
    });
    fixtureSportIds.length = 0;
  }
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
