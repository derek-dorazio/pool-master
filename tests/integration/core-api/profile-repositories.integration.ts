/**
 * Tier and pricing profiles (#1844) against real Postgres: what the migration made of the old
 * per-sport layouts, league overrides and Budget pricing settings, and what the adapters read and
 * write, a profile a sport league names refused deletion.
 */
import { randomUUID } from 'node:crypto';
import { Sport, PlatformTierProfileLastTier } from '@poolmaster/shared/domain';
import { PrismaPlatformPricingProfileRepository, PrismaPlatformTierProfileRepository } from '../../../packages/core-api/src/adapters';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { SPORT_PLATFORM_TIER_PROFILE_CODE, sportLeagueRowDefaults } from '../../support/league-profiles';
import { expectDefined } from '../../support/expect-defined';
import type { ProfileTaken } from '@poolmaster/shared/db';

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

describe('The migration to tier and pricing profiles', () => {
  it('points every seeded sport league at its old layout: its sport\'s, or the College Football Playoff\'s and the PWHL\'s own count of two', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      include: { sport: true, platformTierProfile: true },
      orderBy: [{ sport: { sport: 'asc' } }, { name: 'asc' }],
    });
    const overrides: Record<string, string> = { 'College Football Playoff': 'TIERS_6_OF_2', PWHL: 'TIERS_2_OF_2' };

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

  it('makes Standard and Small pricing profiles from the Budget pricing settings\' defaults, points every sport league at Standard, and drops the settings group', async () => {
    const prisma = getPrisma();
    const [standard, small] = await Promise.all([
      prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'STANDARD' } }),
      prisma.platformPricingProfile.findUniqueOrThrow({ where: { code: 'SMALL' } }),
    ]);

    expect(standard).toMatchObject({ name: 'Standard', ...STANDARD_VALUES });
    expect(small).toMatchObject({ name: 'Small', ...STANDARD_VALUES, salaryCap: 5000, unit: 10 });
    await expect(prisma.sportLeague.count({ where: { platformPricingProfileId: { not: standard.id }, id: { notIn: [...made.sportLeagueIds] } } })).resolves.toBe(0);
    await expect(prisma.platformRuntimeConfig.count({ where: { configKey: 'BUDGET_PRICING_CONFIG' } })).resolves.toBe(0);
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
    const created = written(await repo.create({ code, name, tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15 }));
    made.platformTierProfileIds.add(created.id);

    await expect(repo.findById(created.id)).resolves.toMatchObject({ code, name, lastTier: 'CAPPED', lastTierMax: 15 });
    const updated = await repo.update(created.id, { code, name: `${name} b`, tierCount: 4, tierSize: 8, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null });
    expect(updated).toMatchObject({ id: created.id, name: `${name} b`, tierCount: 4, tierSize: 8, lastTier: 'ALL_REMAINING', lastTierMax: null });
    const all = await repo.findAll();
    expect(all.map((profile) => profile.name)).toEqual([...all.map((profile) => profile.name)].sort((left, right) => left.localeCompare(right)));
    expect(all.some((profile) => profile.id === created.id)).toBe(true);
  });

  it('refuses a capped last tier with no maximum in the database too', async () => {
    const prisma = getPrisma();

    await expect(prisma.platformTierProfile.create({ data: { code: uniqueCode(), name: uniqueName('No cap'), tierCount: 6, tierSize: 10, lastTier: 'CAPPED', lastTierMax: null } })).rejects.toThrow();
  });

  it('reads a sport league\'s tier profile, counts the leagues naming each profile, and answers an unknown league with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const profile = written(await repo.create({ code: uniqueCode(), name: uniqueName('Counted'), tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    made.platformTierProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const leagues = await Promise.all([1, 2].map(async (index) => prisma.sportLeague.create({
      data: { ...(await sportLeagueRowDefaults(prisma)), platformTierProfileId: profile.id, sportId: golf.id, name: uniqueName(`Counted tour ${index}`) },
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
    const layout = { tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
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
    const layout = { tierCount: 3, tierSize: 3, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
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
      data: { code: 'six of ten', name: uniqueName('Bad code'), tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null },
    })).rejects.toThrow(/platform_tier_profiles_code_format/);
  });

  it('refuses to delete a profile a sport league names, answering how many name it and keeping it; deletes one none names; answers an unknown one with null', async () => {
    const prisma = getPrisma();
    const repo = new PrismaPlatformTierProfileRepository(getAppPrisma());
    const used = written(await repo.create({ code: uniqueCode(), name: uniqueName('Used'), tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    const unused = written(await repo.create({ code: uniqueCode(), name: uniqueName('Unused'), tierCount: 2, tierSize: 2, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null }));
    made.platformTierProfileIds.add(used.id);
    made.platformTierProfileIds.add(unused.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { ...(await sportLeagueRowDefaults(prisma)), platformTierProfileId: used.id, sportId: golf.id, name: uniqueName('Using tour') } });
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
    const profile = written(await repo.create({ code, name, ...STANDARD_VALUES, steepness: 2.5 }));
    made.platformPricingProfileIds.add(profile.id);
    const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
    const league = await prisma.sportLeague.create({ data: { ...(await sportLeagueRowDefaults(prisma)), platformPricingProfileId: profile.id, sportId: golf.id, name: uniqueName('Priced tour') } });
    made.sportLeagueIds.add(league.id);

    await expect(repo.findById(profile.id)).resolves.toMatchObject({ code, name, steepness: 2.5 });
    await expect(repo.findBySportLeague(league.id)).resolves.toMatchObject({ id: profile.id });
    await expect(repo.findBySportLeague(randomUUID())).resolves.toBeNull();
    await expect(repo.update(profile.id, { code, name, ...STANDARD_VALUES, unit: 50 })).resolves.toMatchObject({ unit: 50, steepness: 4 });
    await expect(repo.create({ code: uniqueCode(), name, ...STANDARD_VALUES })).resolves.toBe('nameTaken');
    await expect(repo.create({ code, name: uniqueName('Recoded'), ...STANDARD_VALUES })).resolves.toBe('codeTaken');
    await expect(repo.countSportLeaguesNaming(profile.id)).resolves.toBe(1);
    expect((await repo.countSportLeagues()).get(profile.id)).toBe(1);
    await expect(repo.deleteUnlessUsed(profile.id)).resolves.toBe(1);
    await expect(repo.findById(profile.id)).resolves.not.toBeNull();
  });
});
