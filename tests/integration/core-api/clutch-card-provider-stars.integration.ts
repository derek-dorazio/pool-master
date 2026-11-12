import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ParticipantRoundStatus, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import { BalldontlieAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { scoringFamilyForEvent } from '../../../packages/core-api/src/modules/scoring-families/registry';
import { createFakeBalldontlie } from '../../support/balldontlie-fake-api';
import { nbaRoutes } from '../../support/balldontlie-nba-routes';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

// A Clutch Card's stars and box scores from BALLDONTLIE against real Postgres (#1497): the
// admin's "Load Participant Field" on an event linked to the provider's NBA Finals round, then a
// live score sync. The provider is the fake API serving the NBA fixtures, checked against the
// vendor's document; everything past the adapter is the real write path. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = 'balldontlie';
const ROUND = 'nba-2023-postseason-round-4';
const API_KEY = 'test-api-key';

let restoreFetch: (() => void) | undefined;
afterEach(() => restoreFetch?.());

function adapter() {
  const api = createFakeBalldontlie({ league: ['nba', 'ncaab', 'ncaaw'], apiKey: API_KEY, routes: nbaRoutes });
  const originalFetch = global.fetch;
  global.fetch = api.fetch;
  restoreFetch = () => {
    global.fetch = originalFetch;
    expect(api.violations).toEqual([]);
  };
  return new BalldontlieAdapter({ baseUrl: 'https://api.balldontlie.io', apiKey: API_KEY, requestsPerMinute: 600 });
}

/**
 * An NBA Finals Clutch Card linked to the provider's round, keyed as the migration keys the
 * seeded league, whose field already holds Jayson Tatum, loaded from a sport data file: affiliated
 * with the league, ranked first, and with no provider mapping.
 */
async function finalsWithLoadedStar() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const basketball = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const league = await prisma.sportLeague.create({
    data: { sportId: basketball.id, name: `NBA Finals ${suffix}`, matchKeyword: 'NBA Finals', participantType: 'INDIVIDUAL', scoringFamily: ScoringFamily.COMPOSITE },
  });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: league.id, name: `NBA Finals ${suffix}` } });
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id,
      eventYear: 2024,
      externalId: ROUND,
      providerId: PROVIDER,
      sport: Sport.BASKETBALL,
      name: 'NBA Finals',
      startDate: new Date('2024-06-03T23:30:00.000Z'),
      status: 'IN_PROGRESS',
      rounds: 7,
      syncScope: 'SCORES_ONLY',
    },
  });
  await prisma.sportEventRound.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((roundNumber) => ({ sportEventId: event.id, roundNumber, scheduledDate: new Date(Date.UTC(2024, 5, 1 + roundNumber * 2)) })),
  });
  const tatum = await prisma.participant.create({
    data: { sportId: basketball.id, name: 'Jayson Tatum', participantType: 'INDIVIDUAL', leagueAffiliations: { create: { sportLeagueId: league.id, ranking: 1 } } },
  });
  const tatumEntry = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: tatum.id, ranking: 1 } });
  return { event, tatum, tatumEntry };
}

describe('a Clutch Card\'s stars and box scores from the provider', () => {
  it('loads the round\'s field, linking the star already loaded to his provider player and keeping his ranking, and adding the rest of both rosters', async () => {
    const { event, tatum, tatumEntry } = await finalsWithLoadedStar();
    const detail = await adapter().getEventDetails(ROUND);

    await new IngestionPersistence(getAppPrisma()).persistEventDetailWithDiagnostics(detail as NonNullable<typeof detail>);

    const prisma = getPrisma();
    await expect(prisma.participantProviderMapping.findUniqueOrThrow({ where: { providerId_externalId: { providerId: PROVIDER, externalId: 'nba-player-3202' } } }))
      .resolves.toMatchObject({ participantId: tatum.id, confidence: 'HIGH' });
    await expect(prisma.participant.count({ where: { name: 'Jayson Tatum' } })).resolves.toBe(1);
    const field = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { participant: true }, orderBy: { participant: { name: 'asc' } } });
    expect(field.map((entry) => [entry.participant.name, entry.ranking])).toEqual([
      ['Jaylen Brown', null],
      ['Jayson Tatum', 1],
      ['Kyrie Irving', null],
      ['Luka Doncic', null],
      ['Neemias Queta', null],
    ]);
    expect(field.find((entry) => entry.participantId === tatum.id)?.id).toBe(tatumEntry.id);
  });

  it('then writes each played game\'s lines from a live sync, the live game\'s in progress, under the stars the load linked', async () => {
    const { event, tatumEntry } = await finalsWithLoadedStar();
    const provider = adapter();
    const detail = await provider.getEventDetails(ROUND);
    await new IngestionPersistence(getAppPrisma()).persistEventDetailWithDiagnostics(detail as NonNullable<typeof detail>);

    const result = await publishLiveScoreUpdate(await provider.getLiveScores(ROUND), { prisma: getAppPrisma(), providerId: PROVIDER, scoringFamilyForEvent });

    // Game 4, not yet tipped off, writes nothing.
    expect(result).toMatchObject({ updatesReturned: 4, updatesPersisted: 3, updatesSkipped: 1 });
    const tatumRounds = await getPrisma().sportEventParticipantRound.findMany({
      where: { sportEventParticipantId: tatumEntry.id },
      include: { sportEventRound: true, statLines: true },
      orderBy: { sportEventRound: { roundNumber: 'asc' } },
    });
    expect(tatumRounds.map((round) => [round.sportEventRound.roundNumber, round.status, Object.fromEntries(round.statLines.map((line) => [line.stat, line.value]))])).toEqual([
      [1, ParticipantRoundStatus.COMPLETED, { POINTS: 22, REBOUNDS: 12, ASSISTS: 6 }],
      [2, ParticipantRoundStatus.COMPLETED, { POINTS: 18, REBOUNDS: 9, ASSISTS: 7 }],
      [3, ParticipantRoundStatus.IN_PROGRESS, { POINTS: 15, REBOUNDS: 6, ASSISTS: 4 }],
    ]);
    // Queta sat game 1 out and has no line for it; he played game 2.
    const queta = await getPrisma().sportEventParticipantRound.findMany({
      where: { sportEventParticipant: { sportEventId: event.id, participant: { name: 'Neemias Queta' } } },
      include: { sportEventRound: true },
    });
    expect(queta.map((round) => round.sportEventRound.roundNumber)).toEqual([2]);
  });
});
