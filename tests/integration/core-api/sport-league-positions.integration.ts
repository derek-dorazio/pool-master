/**
 * A sport league's positions and the play every league states (#2001), against real Postgres:
 * what the migration seeds, what the tables refuse, and the League page's read of them over HTTP.
 * No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProviderCode, Sport } from '@poolmaster/shared/domain';
import { SportLeaguePositionListResponseSchema } from '@poolmaster/shared/dto';
import { cleanupTestData, createTestUser, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { sportPlay } from '../../support/sport-play';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The NFL sport league the baseline migration seeds, by its id. */
const NFL_SPORT_LEAGUE_ID = 'f91f2566-1978-4171-a706-ae417c4d601a';

async function sportId(sport: Sport): Promise<string> {
  return (await getPrisma().sport.findUniqueOrThrow({ where: { sport }, select: { id: true } })).id;
}

/** A golf league of the test's own, mapped to BALLDONTLIE's PGA TOUR; returns it with its mapping id. */
async function mappedGolfLeague(name: string) {
  const prisma = getPrisma();
  const league = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), sportId: await sportId(Sport.GOLF), name: `${name} ${randomUUID().slice(0, 8)}` },
  });
  const mappingId = await syncLeagueTo(prisma, league.id, 'pga');
  return { league, mappingId };
}

async function get(url: string) {
  const rootAdmin = await createTestUser({ isRootAdmin: true });
  return getApp().inject({ method: 'GET', url, headers: rootAdmin.headers });
}

describe('the migration that makes play a league fact', () => {
  it('gives every seeded sport league its sport\'s participant type and scoring family: teams head to head, golf stroke play, racing by finish position', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ select: { participantType: true, scoringFamily: true, sport: { select: { sport: true } } } });

    expect(leagues.length).toBeGreaterThan(0);
    for (const league of leagues) {
      expect({ sport: league.sport.sport, participantType: league.participantType, scoringFamily: league.scoringFamily })
        .toEqual({ sport: league.sport.sport, ...sportPlay(league.sport.sport) });
    }
  });

  it('seeds the NFL\'s seven positions in display order, only QB, RB, WR and TE field-eligible, each with its BALLDONTLIE code on the NFL\'s mapping', async () => {
    const positions = await getPrisma().sportLeaguePosition.findMany({
      where: { sportLeagueId: NFL_SPORT_LEAGUE_ID },
      orderBy: { displayOrder: 'asc' },
      select: { code: true, isFieldEligible: true, providerCodes: { select: { providerCode: true, sportLeagueProviderMapping: { select: { providerLeague: { select: { code: true } } } } } } },
    });

    expect(positions.map((position) => [position.code, position.isFieldEligible])).toEqual([
      ['QB', true], ['RB', true], ['WR', true], ['TE', true], ['FB', false], ['K', false], ['P', false],
    ]);
    for (const position of positions) {
      expect(position.providerCodes.map((code) => [code.providerCode, code.sportLeagueProviderMapping.providerLeague.code])).toEqual([[position.code, 'nfl']]);
    }
  });
});

describe('what the position tables refuse', () => {
  it('refuses a position code that is not capital letters, digits and underscores', async () => {
    const { league } = await mappedGolfLeague('Position Code Tour');

    await expect(getPrisma().sportLeaguePosition.create({ data: { sportLeagueId: league.id, code: 'qb', displayOrder: 1, isFieldEligible: true } }))
      .rejects.toThrow(/sport_league_positions_code_check/);
  });

  it('refuses a second position with the same code in one league, and takes it in another', async () => {
    const prisma = getPrisma();
    const first = await mappedGolfLeague('Position Twice Tour');
    const second = await mappedGolfLeague('Position Elsewhere Tour');
    await prisma.sportLeaguePosition.create({ data: { sportLeagueId: first.league.id, code: 'GOLFER', displayOrder: 1, isFieldEligible: true } });

    await expect(prisma.sportLeaguePosition.create({ data: { sportLeagueId: first.league.id, code: 'GOLFER', displayOrder: 2, isFieldEligible: true } }))
      .rejects.toThrow(/Unique constraint/);
    await expect(prisma.sportLeaguePosition.create({ data: { sportLeagueId: second.league.id, code: 'GOLFER', displayOrder: 1, isFieldEligible: true } }))
      .resolves.toMatchObject({ code: 'GOLFER' });
  });

  it('refuses a provider code that ties one league\'s position to another league\'s provider mapping', async () => {
    const prisma = getPrisma();
    const own = await mappedGolfLeague('Position Own Tour');
    const other = await mappedGolfLeague('Position Other Tour');
    const position = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: own.league.id, code: 'GOLFER', displayOrder: 1, isFieldEligible: true } });

    await expect(prisma.sportLeaguePositionProviderMapping.create({
      data: { sportLeagueId: own.league.id, sportLeaguePositionId: position.id, sportLeagueProviderMappingId: other.mappingId, providerCode: 'G' },
    })).rejects.toThrow(/sport_league_position_provider_mappings_provider_mapping_fkey/);
  });

  it('refuses one provider code naming two positions on one mapping, and lets two codes name one position', async () => {
    const prisma = getPrisma();
    const { league, mappingId } = await mappedGolfLeague('Position Codes Tour');
    const golfer = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: league.id, code: 'GOLFER', displayOrder: 1, isFieldEligible: true } });
    const caddie = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: league.id, code: 'CADDIE', displayOrder: 2, isFieldEligible: false } });
    const code = (sportLeaguePositionId: string, providerCode: string) => prisma.sportLeaguePositionProviderMapping.create({
      data: { sportLeagueId: league.id, sportLeaguePositionId, sportLeagueProviderMappingId: mappingId, providerCode },
    });
    await code(golfer.id, 'G');
    await code(golfer.id, 'PRO');

    await expect(code(caddie.id, 'G')).rejects.toThrow(/Unique constraint/);
  });
});

describe('GET /api/v1/sport-leagues/{sportLeagueId}/positions', () => {
  it('lists the NFL\'s positions by display order, each with its field eligibility and BALLDONTLIE\'s NFL code', async () => {
    const response = await get(`/api/v1/sport-leagues/${NFL_SPORT_LEAGUE_ID}/positions`);

    expect(response.statusCode).toBe(200);
    const { positions } = SportLeaguePositionListResponseSchema.parse(response.json());
    expect(positions.map((position) => position.code)).toEqual(['QB', 'RB', 'WR', 'TE', 'FB', 'K', 'P']);
    expect(positions[0]).toEqual({
      id: expect.any(String),
      code: 'QB',
      displayOrder: 1,
      isFieldEligible: true,
      providerCodes: [{ providerCode: 'QB', provider: ProviderCode.BALLDONTLIE, providerLeagueCode: 'nfl', providerLeagueName: expect.any(String) }],
    });
  });

  it('answers an empty list for a league with no positions', async () => {
    const { league } = await mappedGolfLeague('Positionless Tour');

    const response = await get(`/api/v1/sport-leagues/${league.id}/positions`);

    expect(response.statusCode).toBe(200);
    expect(SportLeaguePositionListResponseSchema.parse(response.json()).positions).toEqual([]);
  });

  it('answers a signed-in member who is not a root admin with 403, and 404 for a sport league that does not exist', async () => {
    const member = await createTestUser();

    const refused = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${NFL_SPORT_LEAGUE_ID}/positions`, headers: member.headers });
    const missing = await get(`/api/v1/sport-leagues/${randomUUID()}/positions`);

    expect(refused.statusCode).toBe(403);
    expect(missing.statusCode).toBe(404);
  });
});
