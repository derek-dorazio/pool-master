/**
 * Tier and pricing profiles (#1844) against real Postgres: what the migration made of the old
 * per-sport layouts, league overrides and Budget pricing settings, and what the adapters read and
 * write, a profile a sport league names refused deletion.
 */
import { randomUUID } from 'node:crypto';
import { FieldOrderBasis, Sport, PlatformTierProfileLastTier, TierProfileType } from '@poolmaster/shared/domain';
import { PrismaPlatformPricingProfileRepository, PrismaPlatformTierProfileRepository } from '../../../packages/core-api/src/adapters';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { SPORT_PLATFORM_TIER_PROFILE_CODE, sportLeagueRowDefaults } from '../../support/league-profiles';
import { expectDefined } from '../../support/expect-defined';
import type { ProfileTaken } from '@poolmaster/shared/db';
import { sportPlay } from '../../support/sport-play';

const made = { platformTierProfileIds: new Set<string>(), platformPricingProfileIds: new Set<string>(), sportLeagueIds: new Set<string>() };

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportLeague.deleteMany({ where: { id: { in: [...made.sportLeagueIds] } } });
  await prisma.platformTierProfile.deleteMany({ where: { id: { in: [...made.platformTierProfileIds] } } });
  await prisma.platformPricingProfile.deleteMany({ where: { id: { in: [...made.platformPricingProfileIds] } } });
  await teardownIntegrationTests();
});

/** A name no reference profile has. */
function uniqueName(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

/** A code no reference profile has. */
function uniqueCode(): string {
  return `TEST_${randomUUID().slice(0, 8).toUpperCase().replaceAll('-', '_')}`;
}

/** The id the baseline gave the "6 tiers of 5" profile, which migration 20271218003500 deletes. */
const OLD_STAT_POOL_PLATFORM_TIER_PROFILE_ID = '3ab96023-4255-43c1-ab20-f4c79ae926ec';

const STANDARD_VALUES = { salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };
const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];
const SEED_FIRST = [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING];
const EQUAL_GROUPS = { type: TierProfileType.EQUAL_GROUPS, sources: ODDS_FIRST } as const;
const SEED_RANGES = [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }];

describe('The migration to tier and pricing profiles', () => {
  it('points every seeded sport league at its old layout: its sport\'s, or NCAA Men\'s Football\'s and the PWHL\'s own count of two, and the NFL at its playoff seed ranges (#2160)', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      include: { sport: true, platformTierProfile: true },
      orderBy: [{ sport: { sport: 'asc' } }, { name: 'asc' }],
    });
    const overrides: Record<string, string> = { 'NCAA Men\'s Football': 'TIERS_6_OF_2', PWHL: 'TIERS_2_OF_2', NFL: 'PLAYOFF_SEEDS_1_4_REST' };

    const mismatched = leagues.flatMap((league) => {
      const expected = overrides[league.name] ?? SPORT_PLATFORM_TIER_PROFILE_CODE[league.sport.sport];
      return league.platformTierProfile.code === expected ? [] : [`${league.sport.sport} ${league.name}: ${league.platformTierProfile.code}, expected ${expected}`];
    });

    expect(leagues.length).toBeGreaterThan(30);
    expect(mismatched).toEqual([]);
  });

  it('makes each old layout a profile whose last tier takes everyone left, named and coded for its count and size', async () => {
    const profiles = await getPrisma().platformTierProfile.findMany({ where: { code: { in: [...Object.values(SPORT_PLATFORM_TIER_PROFILE_CODE), 'TIERS_6_OF_2', 'TIERS_2_OF_2'] } } });

    expect(profiles.length).toBe(12);
    for (const profile of profiles) {
      expect(profile).toMatchObject({
        code: `TIERS_${profile.tierCount}_OF_${profile.tierSize}`,
        name: `${profile.tierCount} tiers of ${profile.tierSize}`,
        lastTier: 'ALL_REMAINING',
        lastTierMax: null,
      });
    }
  });

  it('leaves out the old stat pools\' six-of-five profile, which no sport league names since the old Clutch Card leagues went (#2059)', async () => {
    await expect(getPrisma().platformTierProfile.findUnique({ where: { id: OLD_STAT_POOL_PLATFORM_TIER_PROFILE_ID } })).resolves.toBeNull();
  });

  it('makes Standard and Small pricing profiles from the Budget pricing settings\' defaults, points every sport league but the NFL at Standard, and drops the settings group', async () => {
    const prisma = getPrisma();
    const [standard, small] = await Promise.all([
      prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'STANDARD' } }),
      prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'SMALL' } }),
    ]);

    expect(standard).toMatchObject({ name: 'Standard', ...STANDARD_VALUES });
    expect(small).toMatchObject({ name: 'Small', ...STANDARD_VALUES, salaryCap: 5000, unit: 10 });
    await expect(prisma.sportLeague.count({ where: { platformPricingProfileId: { not: standard.id }, id: { notIn: [...made.sportLeagueIds] }, urlSegment: { not: 'nfl' } } })).resolves.toBe(0);
    await expect(prisma.platformRuntimeConfig.count({ where: { configKey: 'BUDGET_PRICING_CONFIG' } })).resolves.toBe(0);
  });

  it('gives every existing profile the sources odds, seed, rank, and the NFL a seed-ranges tier profile and Standard prices by seed, both starting with seed (#2160)', async () => {
    const prisma = getPrisma();
    const sourcesOf = (rows: { source: string }[]) => rows.map(({ source }) => source);
    const nfl = await prisma.sportLeague.findFirstOrThrow({
      where: { urlSegment: 'nfl' },
      include: {
        platformTierProfile: { include: { sources: { orderBy: { orderIndex: 'asc' } }, ranges: { orderBy: { tierNumber: 'asc' } } } },
        platformPricingProfile: { include: { sources: { orderBy: { orderIndex: 'asc' } } } },
      },
    });
    const standard = await prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'STANDARD' }, include: { sources: { orderBy: { orderIndex: 'asc' } } } });
    const golfTiers = await prisma.platformTierProfile.findUniqueOrThrow({ where: { code: 'TIERS_6_OF_10' }, include: { sources: { orderBy: { orderIndex: 'asc' } } } });

    expect(sourcesOf(standard.sources)).toEqual(ODDS_FIRST);
    expect([golfTiers.type, sourcesOf(golfTiers.sources)]).toEqual(['EQUAL_GROUPS', ODDS_FIRST]);
    expect(nfl.platformTierProfile).toMatchObject({ code: 'PLAYOFF_SEEDS_1_4_REST', type: 'RANGES', tierCount: null, tierSize: null, lastTier: null, lastTierMax: null });
    expect(nfl.platformTierProfile.ranges.map(({ tierNumber, fromValue, toValue }) => ({ tierNumber, fromValue, toValue }))).toEqual(SEED_RANGES);
    expect(sourcesOf(nfl.platformTierProfile.sources)).toEqual(SEED_FIRST);
    expect(nfl.platformPricingProfile).toMatchObject({ code: 'STANDARD_BY_SEED', ...STANDARD_VALUES });
    expect(sourcesOf(nfl.platformPricingProfile.sources)).toEqual(SEED_FIRST);
  });
});

/** A write the test expects to succeed: its profile, failing the test on `'codeTaken'` or `'nameTaken'`. */
function written<T>(result: T | ProfileTaken): T {
  if (result === 'codeTaken' || result === 'nameTaken') throw new Error('expected the write to succeed, but another profile has its code or name');
  return result;
}

describe('PrismaPlatformTierProfileRepository', () => {
  it('creates, finds by id, updates and lists a profile, a capped one reading back its cap', async () => {
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const name = uniqueName('Capped');
    const code = uniqueCode();
    const created = written(await repo.create({ code, name, ...EQUAL_GROUPS, tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15 }));
    made.platformTierProfileIds.add(created.id);

    await expect(repo.findById(created.id)).resolves.toMatchObject({ code, name, lastTier: 'CAPPED', lastTierMax: 15 });
    const updated = await repo.update(created.id, { code, name: `${name} b`, ...EQUAL_GROUPS, tierCount: 4, tierSize: 8, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    expect(updated).toMatchObject({ id: created.id, name: `${name} b`, tierCount: 4, tierSize: 8, lastTier: 'ALL_REMAINING', lastTierMax: null });
    const all = await repo.findAll();
    expect(all.map((profile) => profile.name)).toEqual([...all.map((profile) => profile.name)].sort((left, right) => left.localeCompare(right)));
    expect(all.some((profile) => profile.id === created.id)).toBe(true);
  });

  it('creates a ranges profile with its sources and ranges and no equal-groups columns, then replaces both lists in one write', async () => {
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const code = uniqueCode();
    const name = uniqueName('Seed ranges');
    const created = written(await repo.create({ code, name, type: TierProfileType.RANGES, sources: SEED_FIRST, ranges: SEED_RANGES }));
    made.platformTierProfileIds.add(created.id);

    await expect(repo.findById(created.id)).resolves.toEqual(expect.objectContaining({ type: 'RANGES', sources: SEED_FIRST, ranges: SEED_RANGES }));
    const twoTiers = [{ tierNumber: 1, fromValue: 1, toValue: 2 }, { tierNumber: 2, fromValue: 3, toValue: null }];
    await expect(repo.update(created.id, { code, name, type: TierProfileType.RANGES, sources: [FieldOrderBasis.RANKING], ranges: twoTiers }))
      .resolves.toEqual(expect.objectContaining({ sources: [FieldOrderBasis.RANKING], ranges: twoTiers }));
    await expect(getPrisma().platformTierProfileRange.count({ where: { platformTierProfileId: created.id } })).resolves.toBe(2);
    // Back to equal groups: the ranges go and the columns come back.
    await expect(repo.update(created.id, { code, name, ...EQUAL_GROUPS, tierCount: 4, tierSize: 4, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }))
      .resolves.toEqual(expect.objectContaining({ type: 'EQUAL_GROUPS', tierCount: 4 }));
    await expect(getPrisma().platformTierProfileRange.count({ where: { platformTierProfileId: created.id } })).resolves.toBe(0);
  });

  it('refuses in the database a ranges profile that also sets a tier count, and an equal-groups profile with no tier count', async () => {
    const prisma = getPrisma();

    await expect(prisma.platformTierProfile.create({ data: { code: uniqueCode(), name: uniqueName('Both'), type: 'RANGES', tierCount: 3, tierSize: null, lastTier: null, lastTierMax: null } })).rejects.toThrow();
    await expect(prisma.platformTierProfile.create({ data: { code: uniqueCode(), name: uniqueName('Neither'), type: 'EQUAL_GROUPS', tierCount: null, tierSize: 3, lastTier: 'ALL_REMAINING', lastTierMax: null } })).rejects.toThrow();
  });

  it('refuses in the database a source listed twice on one profile', async () => {
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const profile = written(await repo.create({ code: uniqueCode(), name: uniqueName('Twice'), ...EQUAL_GROUPS, tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    made.platformTierProfileIds.add(profile.id);

    await expect(getPrisma().platformTierProfileSource.create({ data: { platformTierProfileId: profile.id, orderIndex: 5, source: 'ODDS' } })).rejects.toThrow();
  });

  it('reads the first source of the pricing profile each league naming a tier profile has, and none for a profile no league names', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const pricing = new PrismaPlatformPricingProfileRepository(getAppPrisma());
    const tiers = written(await repo.create({ code: uniqueCode(), name: uniqueName('Paired'), ...EQUAL_GROUPS, tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    const bySeed = written(await pricing.create({ code: uniqueCode(), name: uniqueName('By seed'), sources: SEED_FIRST, ...STANDARD_VALUES }));
    made.platformTierProfileIds.add(tiers.id);
    made.platformPricingProfileIds.add(bySeed.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({
      data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), platformTierProfileId: tiers.id, platformPricingProfileId: bySeed.id, sportId: golf.id, name: uniqueName('Paired tour') },
    });
    made.sportLeagueIds.add(league.id);

    await expect(repo.findPairedFirstSources(tiers.id)).resolves.toEqual([FieldOrderBasis.SEED]);
    await expect(pricing.findPairedFirstSources(bySeed.id)).resolves.toEqual([FieldOrderBasis.ODDS]);
    await expect(repo.findPairedFirstSources(randomUUID())).resolves.toEqual([]);
  });

  it('refuses a capped last tier with no maximum in the database too', async () => {
    const prisma = getPrisma();

    await expect(prisma.platformTierProfile.create({ data: { code: uniqueCode(), name: uniqueName('No cap'), type: 'EQUAL_GROUPS', tierCount: 6, tierSize: 10, lastTier: 'CAPPED', lastTierMax: null } })).rejects.toThrow();
  });

  it('reads a sport league\'s tier profile, counts the leagues naming each profile, and answers an unknown league with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const profile = written(await repo.create({ code: uniqueCode(), name: uniqueName('Counted'), ...EQUAL_GROUPS, tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    made.platformTierProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const leagues = await Promise.all([1, 2].map(async (index) => prisma.sportLeague.create({
      data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), platformTierProfileId: profile.id, sportId: golf.id, name: uniqueName(`Counted tour ${index}`) },
    })));
    leagues.forEach((league) => made.sportLeagueIds.add(league.id));

    await expect(repo.findBySportLeague(expectDefined(leagues[0]).id)).resolves.toMatchObject({ id: profile.id });
    await expect(repo.findBySportLeague(randomUUID())).resolves.toBeNull();
    expect((await repo.countSportLeagues()).get(profile.id)).toBe(2);
    await expect(repo.countSportLeaguesNaming(profile.id)).resolves.toBe(2);
    await expect(repo.countSportLeaguesNaming(randomUUID())).resolves.toBe(0);
  });

  it('answers a create or rename onto a name another tier profile has with nameTaken, writing nothing', async () => {
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const layout = { ...EQUAL_GROUPS, tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
    const first = written(await repo.create({ code: uniqueCode(), name: uniqueName('Taken'), ...layout }));
    const second = written(await repo.create({ code: uniqueCode(), name: uniqueName('Other'), ...layout }));
    made.platformTierProfileIds.add(first.id);
    made.platformTierProfileIds.add(second.id);

    await expect(repo.create({ code: uniqueCode(), name: first.name, ...layout, tierSize: 4 })).resolves.toBe('nameTaken');
    await expect(repo.update(second.id, { code: second.code, name: first.name, ...layout })).resolves.toBe('nameTaken');
    await expect(repo.findById(second.id)).resolves.toMatchObject({ name: second.name });
  });

  it('answers a create or recode onto a code another tier profile has with codeTaken, writing nothing', async () => {
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const layout = { ...EQUAL_GROUPS, tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
    const first = written(await repo.create({ code: uniqueCode(), name: uniqueName('Coded'), ...layout }));
    const second = written(await repo.create({ code: uniqueCode(), name: uniqueName('Recoded'), ...layout }));
    made.platformTierProfileIds.add(first.id);
    made.platformTierProfileIds.add(second.id);

    await expect(repo.create({ code: first.code, name: uniqueName('Fresh'), ...layout })).resolves.toBe('codeTaken');
    await expect(repo.update(second.id, { code: first.code, name: second.name, ...layout })).resolves.toBe('codeTaken');
    await expect(repo.findById(second.id)).resolves.toMatchObject({ code: second.code });
  });

  it('refuses a code that is not capital letters, digits and underscores in the database too', async () => {
    await expect(getPrisma().platformTierProfile.create({
      data: { code: 'six of ten', name: uniqueName('Bad code'), type: 'EQUAL_GROUPS', tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null },
    })).rejects.toThrow(/platform_tier_profiles_code_format/);
  });

  it('refuses to delete a profile a sport league names, answering how many name it and keeping it; deletes one none names; answers an unknown one with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const used = written(await repo.create({ code: uniqueCode(), name: uniqueName('Used'), ...EQUAL_GROUPS, tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    const unused = written(await repo.create({ code: uniqueCode(), name: uniqueName('Unused'), ...EQUAL_GROUPS, tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    made.platformTierProfileIds.add(used.id);
    made.platformTierProfileIds.add(unused.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), platformTierProfileId: used.id, sportId: golf.id, name: uniqueName('Using tour') } });
    made.sportLeagueIds.add(league.id);

    await expect(repo.deleteUnlessUsed(used.id)).resolves.toBe(1);
    await expect(repo.findById(used.id)).resolves.not.toBeNull();
    await expect(repo.deleteUnlessUsed(unused.id)).resolves.toBe(0);
    await expect(repo.findById(unused.id)).resolves.toBeNull();
    await expect(repo.deleteUnlessUsed(randomUUID())).resolves.toBeNull();
  });
});

describe('PrismaPlatformPricingProfileRepository', () => {
  it('creates, reads, updates, and refuses to delete a pricing profile a sport league names', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformPricingProfileRepository(getAppPrisma());
    const name = uniqueName('Pricey');
    const code = uniqueCode();
    const profile = written(await repo.create({ code, name, sources: ODDS_FIRST, ...STANDARD_VALUES, steepness: 2.5 }));
    made.platformPricingProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), platformPricingProfileId: profile.id, sportId: golf.id, name: uniqueName('Priced tour') } });
    made.sportLeagueIds.add(league.id);

    await expect(repo.findById(profile.id)).resolves.toMatchObject({ code, name, steepness: 2.5 });
    await expect(repo.findBySportLeague(league.id)).resolves.toMatchObject({ id: profile.id });
    await expect(repo.findBySportLeague(randomUUID())).resolves.toBeNull();
    await expect(repo.update(profile.id, { code, name, sources: SEED_FIRST, ...STANDARD_VALUES, unit: 50 })).resolves.toMatchObject({ unit: 50, steepness: 4, sources: SEED_FIRST });
    await expect(repo.create({ code: uniqueCode(), name, sources: ODDS_FIRST, ...STANDARD_VALUES })).resolves.toBe('nameTaken');
    await expect(repo.create({ code, name: uniqueName('Recoded'), sources: ODDS_FIRST, ...STANDARD_VALUES })).resolves.toBe('codeTaken');
    await expect(repo.countSportLeaguesNaming(profile.id)).resolves.toBe(1);
    expect((await repo.countSportLeagues()).get(profile.id)).toBe(1);
    await expect(repo.deleteUnlessUsed(profile.id)).resolves.toBe(1);
    await expect(repo.findById(profile.id)).resolves.not.toBeNull();
  });
});
