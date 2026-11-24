import { expect } from '@jest/globals';
import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import { randomUUID } from 'node:crypto';
import { ParticipantRoundStatus, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import { BalldontlieAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { scoringFamilyForEvent } from '../../../packages/core-api/src/modules/scoring-families/registry';
import { createFakeBalldontlie } from '../../support/balldontlie-fake-api';
import { nbaRoutes } from '../../support/balldontlie-nba-routes';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { leagueProfiles, STAT_POOL_TIER_PROFILE_NAME } from '../../support/league-profiles';

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

/** The round's event details from the provider, which has the round. */
async function roundDetail(provider: BalldontlieAdapter) {
  const detail = await provider.getEventDetails(ROUND);
  if (detail === null) throw new Error(`The fake provider has no ${ROUND}`);
  return detail;
}

function adapter() {
  const api = createFakeBalldontlie({ league: ['nba', 'ncaab', 'ncaaw', 'wnba'], apiKey: API_KEY, routes: nbaRoutes });
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
 * seeded league, whose field already holds Jayson Tatum as the test data load leaves him:
 * the league's own participant, ranked first, and his feed id bound by hand (#1850, #1853).
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
    data: { ...(await leagueProfiles(prisma, STAT_POOL_TIER_PROFILE_NAME)), sportId: basketball.id, name: `NBA Finals ${suffix}`, matchKeyword: 'NBA Finals', participantType: 'INDIVIDUAL', scoringFamily: ScoringFamily.COMPOSITE },
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
    data: {
      sportLeagueId: league.id, ranking: 1, name: 'Jayson Tatum', participantType: 'INDIVIDUAL',
      providerMappings: { create: { sportLeagueId: league.id, providerId: PROVIDER, externalId: 'nba-player-3202', confidence: 'MANUAL' } },
    },
  });
  const tatumEntry = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: tatum.id, ranking: 1 } });
  return { event, league, tatum, tatumEntry };
}

/** A star loaded into the Clutch Card's field with no feed id: one of its league's participants, ranked, with no provider mapping. */
async function loadedStar(eventId: string, league: { id: string; sportId: string }, name: string, ranking: number) {
  const prisma = getPrisma();
  const star = await prisma.participant.create({
    data: { sportLeagueId: league.id, ranking, name, participantType: 'INDIVIDUAL' },
  });
  await prisma.sportEventParticipant.create({ data: { sportEventId: eventId, participantId: star.id, ranking } });
  return star;
}

describe('a Clutch Card\'s stars and box scores from the provider', () => {
  it('loads the round\'s field onto the star whose feed id is bound, keeping his ranking, and adds the rest of both rosters', async () => {
    const { event, league, tatum, tatumEntry } = await finalsWithLoadedStar();
    const detail = await roundDetail(adapter());

    await new IngestionPersistence(getAppPrisma(), testDomainEvents()).persistEventDetailWithDiagnostics(detail);

    const prisma = getPrisma();
    await expect(prisma.participantProviderMapping.findUniqueOrThrow({ where: { providerId_externalId_sportLeagueId: { providerId: PROVIDER, externalId: 'nba-player-3202', sportLeagueId: league.id } } }))
      .resolves.toMatchObject({ participantId: tatum.id, confidence: 'MANUAL' });
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

  it('never links a ranked star with no feed id by name: the feed\'s player is a new row beside him, and he is listed as unlinked (#1850)', async () => {
    const { event, league } = await finalsWithLoadedStar();
    const doncic = await loadedStar(event.id, league, 'Luka Dončić', 2);
    const porzingis = await loadedStar(event.id, league, 'Kristaps Porziņģis', 3);

    const result = await new IngestionPersistence(getAppPrisma(), testDomainEvents()).persistEventDetailWithDiagnostics(await roundDetail(adapter()));

    const prisma = getPrisma();
    await expect(prisma.participantProviderMapping.findUniqueOrThrow({ where: { providerId_externalId_sportLeagueId: { providerId: PROVIDER, externalId: 'nba-player-132', sportLeagueId: league.id } } }))
      .resolves.toMatchObject({ participantId: expect.not.stringMatching(doncic.id) as unknown, confidence: 'EXACT' });
    await expect(prisma.participant.count({ where: { name: { in: ['Luka Doncic', 'Luka Dončić'] } } })).resolves.toBe(2);
    expect(result.unlinkedRankedParticipants).toEqual([
      { participantId: doncic.id, name: 'Luka Dončić', ranking: 2 },
      { participantId: porzingis.id, name: 'Kristaps Porziņģis', ranking: 3 },
    ]);
  });

  it('then writes each played game\'s lines from a live sync, the live game\'s in progress, under the star whose feed id is bound', async () => {
    const { event, tatumEntry } = await finalsWithLoadedStar();
    const provider = adapter();
    await new IngestionPersistence(getAppPrisma(), testDomainEvents()).persistEventDetailWithDiagnostics(await roundDetail(provider));

    const result = await publishLiveScoreUpdate(await provider.getLiveScores(ROUND), { contestActivation: NO_CONTEST_ACTIVATION, prisma: getAppPrisma(), providerId: PROVIDER, domainEvents: testDomainEvents(), scoringFamilyForEvent });

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
