/**
 * Tier and pricing profiles (#1844) against real Postgres: what the migration made of the old
 * per-sport layouts, league overrides and Budget pricing settings, and what the adapters read and
 * write, a profile a sport league names refused deletion.
 */
import { randomUUID } from 'node:crypto';
import { Sport, TierProfileLastTier } from '@poolmaster/shared/domain';
import { PrismaPricingProfileRepository, PrismaTierProfileRepository } from '../../../packages/core-api/src/adapters';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { SPORT_TIER_PROFILE_NAME, STAT_POOL_TIER_PROFILE_NAME, leagueProfiles } from '../../support/league-profiles';
import { expectDefined } from '../../support/expect-defined';

const made = { tierProfileIds: new Set<string>(), pricingProfileIds: new Set<string>(), sportLeagueIds: new Set<string>() };

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: [...made.sportLeagueIds] } } });
  await prisma.tierProfile.deleteMany({ where: { id: { in: [...made.tierProfileIds] } } });
  await prisma.pricingProfile.deleteMany({ where: { id: { in: [...made.pricingProfileIds] } } });
  await teardownIntegrationTests();
});

/** A name no reference profile has. */
function uniqueName(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

const STANDARD_VALUES = { salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

describe('The migration to tier and pricing profiles', () => {
  it('points every seeded sport league at its old layout: its sport\'s, a stat pool\'s six of five, or the College Football Playoff\'s and the PWHL\'s own count of two', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      include: { sport: true, tierProfile: true },
      orderBy: [{ sport: { sport: 'asc' } }, { name: 'asc' }],
    });
    const overrides: Record<string, string> = { 'College Football Playoff': '6 tiers of 2', PWHL: '2 tiers of 2' };

    const mismatched = leagues.flatMap((league) => {
      const expected = overrides[league.name]
        ?? (league.scoringFamily === 'COMPOSITE' ? STAT_POOL_TIER_PROFILE_NAME : SPORT_TIER_PROFILE_NAME[league.sport.sport]);
      return league.tierProfile.name === expected ? [] : [`${league.sport.sport} ${league.name}: ${league.tierProfile.name}, expected ${expected}`];
    });

    expect(leagues.length).toBeGreaterThan(40);
    expect(mismatched).toEqual([]);
  });

  it('makes each old layout a profile whose last tier takes everyone left, named for its count and size', async () => {
    const profiles = await getPrisma().tierProfile.findMany({ where: { name: { in: [...Object.values(SPORT_TIER_PROFILE_NAME), STAT_POOL_TIER_PROFILE_NAME, '6 tiers of 2', '2 tiers of 2'] } } });

    expect(profiles.length).toBe(13);
    for (const profile of profiles) {
      expect(profile).toMatchObject({ name: `${profile.tierCount} tiers of ${profile.tierSize}`, lastTier: 'ALL_REMAINING', lastTierMax: null });
    }
  });

  it('makes Standard and Small pricing profiles from the Budget pricing settings\' defaults, points every sport league at Standard, and drops the settings group', async () => {
    const prisma = getPrisma();
    const [standard, small] = await Promise.all([
      prisma.pricingProfile.findUniqueOrThrow({ where: { name: 'Standard' } }),
      prisma.pricingProfile.findUniqueOrThrow({ where: { name: 'Small' } }),
    ]);

    expect(standard).toMatchObject(STANDARD_VALUES);
    expect(small).toMatchObject({ ...STANDARD_VALUES, salaryCap: 5000, unit: 10 });
    await expect(prisma.sportLeague.count({ where: { pricingProfileId: { not: standard.id }, id: { notIn: [...made.sportLeagueIds] } } })).resolves.toBe(0);
    await expect(prisma.platformRuntimeConfig.count({ where: { configKey: 'BUDGET_PRICING_CONFIG' } })).resolves.toBe(0);
  });
});

describe('PrismaTierProfileRepository', () => {
  it('creates, finds by id and name, updates and lists a profile, a capped one reading back its cap', async () => {
    const repo = new PrismaTierProfileRepository(getAppPrisma());
    const name = uniqueName('Capped');
    const created = await repo.create({ name, tierCount: 6, tierSize: 10, lastTier: TierProfileLastTier.CAPPED, lastTierMax: 15 });
    made.tierProfileIds.add(created.id);

    await expect(repo.findById(created.id)).resolves.toMatchObject({ name, lastTier: 'CAPPED', lastTierMax: 15 });
    await expect(repo.findByName(name)).resolves.toMatchObject({ id: created.id });
    const updated = await repo.update(created.id, { name: `${name} b`, tierCount: 4, tierSize: 8, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    expect(updated).toMatchObject({ id: created.id, name: `${name} b`, tierCount: 4, tierSize: 8, lastTier: 'ALL_REMAINING', lastTierMax: null });
    const all = await repo.findAll();
    expect(all.map((profile) => profile.name)).toEqual([...all.map((profile) => profile.name)].sort((left, right) => left.localeCompare(right)));
    expect(all.some((profile) => profile.id === created.id)).toBe(true);
  });

  it('refuses a capped last tier with no maximum in the database too', async () => {
    const prisma = getPrisma();

    await expect(prisma.tierProfile.create({ data: { name: uniqueName('No cap'), tierCount: 6, tierSize: 10, lastTier: 'CAPPED', lastTierMax: null } })).rejects.toThrow();
  });

  it('reads a sport league\'s tier profile, counts the leagues naming each profile, and answers an unknown league with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaTierProfileRepository(getAppPrisma());
    const profile = await repo.create({ name: uniqueName('Counted'), tierCount: 3, tierSize: 3, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    made.tierProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const leagues = await Promise.all([1, 2].map(async (index) => prisma.sportLeague.create({
      data: { ...(await leagueProfiles(prisma)), tierProfileId: profile.id, sportId: golf.id, name: uniqueName(`Counted tour ${index}`) },
    })));
    leagues.forEach((league) => made.sportLeagueIds.add(league.id));

    await expect(repo.findBySportLeague(expectDefined(leagues[0]).id)).resolves.toMatchObject({ id: profile.id });
    await expect(repo.findBySportLeague(randomUUID())).resolves.toBeNull();
    expect((await repo.countSportLeagues()).get(profile.id)).toBe(2);
  });

  it('refuses to delete a profile a sport league names, answering how many name it and keeping it; deletes one none names; answers an unknown one with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaTierProfileRepository(getAppPrisma());
    const used = await repo.create({ name: uniqueName('Used'), tierCount: 2, tierSize: 2, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    const unused = await repo.create({ name: uniqueName('Unused'), tierCount: 2, tierSize: 2, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    made.tierProfileIds.add(used.id);
    made.tierProfileIds.add(unused.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), tierProfileId: used.id, sportId: golf.id, name: uniqueName('Using tour') } });
    made.sportLeagueIds.add(league.id);

    await expect(repo.deleteUnlessUsed(used.id)).resolves.toBe(1);
    await expect(repo.findById(used.id)).resolves.not.toBeNull();
    await expect(repo.deleteUnlessUsed(unused.id)).resolves.toBe(0);
    await expect(repo.findById(unused.id)).resolves.toBeNull();
    await expect(repo.deleteUnlessUsed(randomUUID())).resolves.toBeNull();
  });
});

describe('PrismaPricingProfileRepository', () => {
  it('creates, reads, updates, and refuses to delete a pricing profile a sport league names', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPricingProfileRepository(getAppPrisma());
    const name = uniqueName('Pricey');
    const profile = await repo.create({ name, ...STANDARD_VALUES, steepness: 2.5 });
    made.pricingProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), pricingProfileId: profile.id, sportId: golf.id, name: uniqueName('Priced tour') } });
    made.sportLeagueIds.add(league.id);

    await expect(repo.findByName(name)).resolves.toMatchObject({ id: profile.id, steepness: 2.5 });
    await expect(repo.findBySportLeague(league.id)).resolves.toMatchObject({ id: profile.id });
    await expect(repo.findBySportLeague(randomUUID())).resolves.toBeNull();
    await expect(repo.update(profile.id, { name, ...STANDARD_VALUES, unit: 50 })).resolves.toMatchObject({ unit: 50, steepness: 4 });
    expect((await repo.countSportLeagues()).get(profile.id)).toBe(1);
    await expect(repo.deleteUnlessUsed(profile.id)).resolves.toBe(1);
    await expect(repo.findById(profile.id)).resolves.not.toBeNull();
  });
});
