import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProviderCode, Sport } from '@poolmaster/shared/domain';
import { PrismaSlotNamePatternRepository } from '../../../packages/core-api/src/adapters/prisma-slot-name-pattern-repository';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { nameSlotDefinitionFor } from '../../support/sync-slots';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';

// The slots "link to existing" offers a tournament name finding, and the pattern it adds (#2011),
// against real Postgres: only the league's selected mapping, only for the finding's Provider.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

async function golfLeague() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Pattern Tour ${randomUUID().slice(0, 8)}` }, select: { id: true } });
}

const repository = () => new PrismaSlotNamePatternRepository(getPrisma());
const balldontlie = async () => (await getPrisma().provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE }, select: { id: true } })).id;

describe('PrismaSlotNamePatternRepository', () => {
  it('offers nothing for a league with no selected mapping, for another Provider, or for a league that does not exist', async () => {
    const unsynced = await golfLeague();
    const synced = await golfLeague();
    await syncLeagueTo(getPrisma(), synced.id, 'pga');
    const providerId = await balldontlie();

    expect(await repository().findChoices(unsynced.id, providerId)).toBeNull();
    expect(await repository().findChoices(synced.id, randomUUID())).toBeNull();
    expect(await repository().findChoices(randomUUID(), providerId)).toBeNull();
  });

  it('offers each name-matched slot of the selected mapping once, with all its patterns in order', async () => {
    const prisma = getPrisma();
    const league = await golfLeague();
    const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'pga');
    const [seasonId] = await syncSeasonsTo(prisma, league.id, sportLeagueProviderMappingId, [2027]);
    const memorial = await nameSlotDefinitionFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, pattern: 'the memorial tournament', seasonIds: [seasonId], covered: false });
    expect(await repository().addPattern({ sportLeagueId: league.id, sportLeagueProviderMappingId, slotDefinitionId: memorial, pattern: 'memorial tournament' })).toBe('ADDED');

    const choices = await repository().findChoices(league.id, await balldontlie());

    expect(choices).toEqual({
      sportLeagueProviderMappingId,
      slots: [expect.objectContaining({ slotDefinitionId: memorial, slotKind: 'TOURNAMENT', weekNumber: null, patterns: ['memorial tournament', 'the memorial tournament'] })],
    });
  });

  it('answers TAKEN for a pattern another slot holds, and throws for a slot that does not exist', async () => {
    const prisma = getPrisma();
    const league = await golfLeague();
    const sportLeagueProviderMappingId = await syncLeagueTo(prisma, league.id, 'pga');
    const memorial = await nameSlotDefinitionFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, pattern: 'the memorial tournament', seasonIds: [], covered: false });
    const open = await nameSlotDefinitionFor(prisma, { sportLeagueId: league.id, sportLeagueProviderMappingId, pattern: 'u.s. open', seasonIds: [], covered: false });

    expect(await repository().addPattern({ sportLeagueId: league.id, sportLeagueProviderMappingId, slotDefinitionId: open, pattern: 'the memorial tournament' })).toBe('TAKEN');
    await expect(repository().addPattern({ sportLeagueId: league.id, sportLeagueProviderMappingId, slotDefinitionId: randomUUID(), pattern: 'the new open' })).rejects.toThrow();
    expect(await prisma.sportLeagueCompetitionSlotProviderMapping.count({ where: { sportLeagueCompetitionSlotId: { in: [memorial, open] } } })).toBe(2);
  });
});
