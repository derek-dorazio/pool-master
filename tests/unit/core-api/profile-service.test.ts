import { expect } from '@jest/globals';
import type { PlatformPricingProfileWrite, PlatformTierProfileWrite, ProfileRepository } from '@poolmaster/shared/db';
import { FieldOrderBasis, PlatformTierProfileLastTier, TierProfileType, type PlatformPricingProfile, type PlatformTierProfile } from '@poolmaster/shared/domain';
import {
  PLATFORM_PRICING_PROFILE_KIND,
  ProfileService,
  PLATFORM_TIER_PROFILE_KIND,
} from '../../../packages/core-api/src/modules/profiles/profile-service';
import { fakeLogger } from '../../support/fake-logger';

// The root admin's tier and pricing profiles (#1844): one service for both kinds, against an
// in-memory repository. What the adapters do with a write is asserted against Postgres in
// profile-repositories.integration.

const T0 = new Date('2026-01-01T00:00:00.000Z');

type TierWrite = PlatformTierProfileWrite;
type PricingWrite = PlatformPricingProfileWrite;
type EqualGroupsWrite = Extract<TierWrite, { type: typeof TierProfileType.EQUAL_GROUPS }>;

const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];
const SEED_FIRST = [FieldOrderBasis.SEED, FieldOrderBasis.ODDS, FieldOrderBasis.RANKING];

const SIX_OF_TEN: EqualGroupsWrite = { code: 'TIERS_6_OF_10', name: '6 tiers of 10', sources: ODDS_FIRST, type: TierProfileType.EQUAL_GROUPS, tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };
const STANDARD: PricingWrite = { code: 'STANDARD', name: 'Standard', sources: ODDS_FIRST, salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

/**
 * Profiles in a list, each league naming one by id in `uses`; `paired` holds, by profile id, the
 * first sources of the other kind's profiles its leagues name.
 */
function memoryProfiles<TProfile extends { id: string; code: string; name: string }, TWrite extends { code: string; name: string }>(
  build: (id: string, write: TWrite) => TProfile,
) {
  const rows: TProfile[] = [];
  const uses = new Map<string, number>();
  const paired = new Map<string, FieldOrderBasis[]>();
  let sequence = 0;
  const repo: ProfileRepository<TProfile, TWrite> = {
    findAll: async () => [...rows].sort((left, right) => left.name.localeCompare(right.name)),
    findById: async (id) => rows.find((row) => row.id === id) ?? null,
    findBySportLeague: async () => null,
    countSportLeagues: async () => new Map(uses),
    countSportLeaguesNaming: async (id) => uses.get(id) ?? 0,
    findPairedFirstSources: async (id) => paired.get(id) ?? [],
    // The unique indexes on code and name, as the adapter answers them.
    create: async (write) => {
      if (rows.some((row) => row.code === write.code)) return 'codeTaken';
      if (rows.some((row) => row.name === write.name)) return 'nameTaken';
      const row = build(`profile-${++sequence}`, write);
      rows.push(row);
      return row;
    },
    update: async (id, write) => {
      if (rows.some((row) => row.code === write.code && row.id !== id)) return 'codeTaken';
      if (rows.some((row) => row.name === write.name && row.id !== id)) return 'nameTaken';
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = build(id, write);
      return rows[index];
    },
    deleteUnlessUsed: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      const used = uses.get(id) ?? 0;
      if (used === 0) rows.splice(index, 1);
      return used;
    },
  };
  return { repo, rows, uses, paired };
}

function tierService() {
  const store = memoryProfiles<PlatformTierProfile, TierWrite>((id, write) => ({ id, ...write, sources: [...write.sources], createdAt: T0, updatedAt: T0 }));
  const logger = fakeLogger();
  return { ...store, logger, service: new ProfileService({ profiles: store.repo, kind: PLATFORM_TIER_PROFILE_KIND, logger }) };
}

function pricingService() {
  const store = memoryProfiles<PlatformPricingProfile, PricingWrite>((id, write) => ({ id, ...write, sources: [...write.sources], createdAt: T0, updatedAt: T0 }));
  return { ...store, service: new ProfileService({ profiles: store.repo, kind: PLATFORM_PRICING_PROFILE_KIND }) };
}

describe('ProfileService — tier profiles', () => {
  it('creates a profile with no sport league naming it yet, and lists every profile by name with how many leagues name each', async () => {
    const { service, uses } = tierService();
    const created = await service.create(SIX_OF_TEN);
    await service.create({ ...SIX_OF_TEN, code: 'TIERS_4_OF_16', name: '4 tiers of 16', tierCount: 4, tierSize: 16 });
    uses.set(created.profile.id, 3);

    expect(created.sportLeagueCount).toBe(0);
    expect((await service.list()).map(({ profile, sportLeagueCount }) => [profile.name, sportLeagueCount])).toEqual([
      ['4 tiers of 16', 0],
      ['6 tiers of 10', 3],
    ]);
  });

  it('reads one profile with its league count, and answers an unknown one with 404 PLATFORM_TIER_PROFILE_NOT_FOUND', async () => {
    const { service, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 2);

    await expect(service.get(profile.id)).resolves.toMatchObject({ profile: { name: '6 tiers of 10' }, sportLeagueCount: 2 });
    await expect(service.get('profile-gone')).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses a capped last tier with no maximum, or a maximum on one that takes everyone left, with 422 PLATFORM_TIER_PROFILE_INVALID, creating nothing', async () => {
    const { service, rows } = tierService();

    await expect(service.create({ ...SIX_OF_TEN, lastTier: PlatformTierProfileLastTier.CAPPED }))
      .rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_INVALID', statusCode: 422 });
    await expect(service.create({ ...SIX_OF_TEN, lastTierMax: 12 }))
      .rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_INVALID', statusCode: 422 });
    expect(rows).toEqual([]);
  });

  it('refuses a second profile with a name already taken with 409 PLATFORM_TIER_PROFILE_NAME_TAKEN', async () => {
    const { service, rows } = tierService();
    await service.create(SIX_OF_TEN);

    await expect(service.create({ ...SIX_OF_TEN, code: 'TIERS_6_OF_8', tierSize: 8 })).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NAME_TAKEN', statusCode: 409 });
    expect(rows).toHaveLength(1);
  });

  it('refuses a second profile with a code already taken with 409 PLATFORM_TIER_PROFILE_CODE_TAKEN, and an update onto another profile\'s code the same way', async () => {
    const { service, rows } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    const other = await service.create({ ...SIX_OF_TEN, code: 'TIERS_6_OF_8', name: '6 tiers of 8', tierSize: 8 });

    await expect(service.create({ ...SIX_OF_TEN, name: 'Another name' })).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_CODE_TAKEN', statusCode: 409 });
    await expect(service.update(other.profile.id, { ...other.profile, code: profile.code })).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_CODE_TAKEN', statusCode: 409 });
    expect(rows.map((row) => row.code)).toEqual(['TIERS_6_OF_10', 'TIERS_6_OF_8']);
  });

  it('replaces a profile\'s name and layout, keeping its own name free to reuse, and answers it with its league count', async () => {
    const { service, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 5);

    const updated = await service.update(profile.id, { ...SIX_OF_TEN, lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15 });

    expect(updated).toMatchObject({ profile: { id: profile.id, name: '6 tiers of 10', lastTier: 'CAPPED', lastTierMax: 15 }, sportLeagueCount: 5 });
  });

  it('refuses an update to an unknown profile (404), to bad values (422), or to another profile\'s name (409), changing nothing', async () => {
    const { service, rows } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    await service.create({ ...SIX_OF_TEN, code: 'OTHER', name: 'Other' });

    await expect(service.update('profile-gone', SIX_OF_TEN)).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
    await expect(service.update(profile.id, { ...SIX_OF_TEN, lastTier: PlatformTierProfileLastTier.CAPPED })).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_INVALID', statusCode: 422 });
    await expect(service.update(profile.id, { ...SIX_OF_TEN, name: 'Other' })).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NAME_TAKEN', statusCode: 409 });
    expect(rows.find((row) => row.id === profile.id)).toMatchObject(SIX_OF_TEN);
  });

  it('creates a ranges profile ordered by seed first, with its ranges', async () => {
    const { service } = tierService();
    const ranges = [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }];

    const created = await service.create({ code: 'PLAYOFF_SEEDS_1_4_REST', name: 'Playoff seeds', sources: SEED_FIRST, type: TierProfileType.RANGES, ranges });

    expect(created.profile).toMatchObject({ type: 'RANGES', sources: SEED_FIRST, ranges });
  });

  it('refuses (422 PLATFORM_TIER_PROFILE_INVALID) a ranges profile with a gap between two tiers, creating nothing', async () => {
    const { service, rows } = tierService();
    const ranges = [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 3, toValue: null }];

    await expect(service.create({ code: 'GAPPED', name: 'Gapped', sources: SEED_FIRST, type: TierProfileType.RANGES, ranges }))
      .rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_INVALID', statusCode: 422 });
    expect(rows).toEqual([]);
  });

  it('refuses (422 PROFILE_FIRST_SOURCES_DIFFER) a new first source a league naming the profile does not start its pricing profile with, changing nothing', async () => {
    const { service, rows, paired } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    paired.set(profile.id, [FieldOrderBasis.ODDS]);

    await expect(service.update(profile.id, { ...SIX_OF_TEN, sources: SEED_FIRST }))
      .rejects.toMatchObject({ code: 'PROFILE_FIRST_SOURCES_DIFFER', statusCode: 422 });
    expect(rows[0]?.sources).toEqual(ODDS_FIRST);
  });

  it('accepts reordering the sources after the first, and a new first source while no league names the profile', async () => {
    const { service, paired } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    const free = await service.create({ ...SIX_OF_TEN, code: 'FREE', name: 'Free' });
    paired.set(profile.id, [FieldOrderBasis.ODDS]);

    await expect(service.update(profile.id, { ...SIX_OF_TEN, sources: [FieldOrderBasis.ODDS, FieldOrderBasis.RANKING] })).resolves.toMatchObject({ profile: { sources: ['ODDS', 'RANKING'] } });
    await expect(service.update(free.profile.id, { ...SIX_OF_TEN, code: 'FREE', name: 'Free', sources: SEED_FIRST })).resolves.toMatchObject({ profile: { sources: SEED_FIRST } });
  });

  it('deletes a profile no sport league names', async () => {
    const { service, rows, logger } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);

    await service.delete(profile.id);

    expect(rows).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ profileId: profile.id }), 'Deleted profile');
  });

  it('refuses to delete a profile any sport league names with 409 PLATFORM_TIER_PROFILE_IN_USE, saying how many, and keeps it', async () => {
    const { service, rows, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 2);

    await expect(service.delete(profile.id)).rejects.toMatchObject({
      code: 'PLATFORM_TIER_PROFILE_IN_USE', statusCode: 409, message: expect.stringContaining('named by 2 sport leagues'),
    });
    uses.set(profile.id, 1);
    await expect(service.delete(profile.id)).rejects.toMatchObject({ message: expect.stringContaining('named by 1 sport league,') });
    expect(rows).toHaveLength(1);
  });

  it('answers a delete of an unknown profile with 404 PLATFORM_TIER_PROFILE_NOT_FOUND', async () => {
    const { service } = tierService();

    await expect(service.delete('profile-gone')).rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
  });
});

describe('ProfileService — pricing profiles', () => {
  it('creates a pricing profile and refuses one whose floor share is above its top share with 422 PLATFORM_PRICING_PROFILE_INVALID', async () => {
    const { service, rows } = pricingService();

    await expect(service.create(STANDARD)).resolves.toMatchObject({ profile: STANDARD, sportLeagueCount: 0 });
    await expect(service.create({ ...STANDARD, name: 'Upside down', floorSharePercent: 30 }))
      .rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_INVALID', statusCode: 422 });
    expect(rows).toHaveLength(1);
  });

  it('answers pricing profiles\' own codes: 409 PLATFORM_PRICING_PROFILE_NAME_TAKEN, 404 PLATFORM_PRICING_PROFILE_NOT_FOUND and 409 PLATFORM_PRICING_PROFILE_IN_USE', async () => {
    const { service, uses } = pricingService();
    const { profile } = await service.create(STANDARD);
    uses.set(profile.id, 1);

    await expect(service.create({ ...STANDARD, code: 'STANDARD_2' })).rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_NAME_TAKEN', statusCode: 409 });
    await expect(service.create({ ...STANDARD, name: 'Standard 2' })).rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_CODE_TAKEN', statusCode: 409 });
    await expect(service.get('profile-gone')).rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_NOT_FOUND', statusCode: 404 });
    await expect(service.delete(profile.id)).rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_IN_USE', statusCode: 409 });
  });

  it('refuses (422 PROFILE_FIRST_SOURCES_DIFFER) a pricing profile\'s new first source its leagues\' tier profiles do not start with', async () => {
    const { service, paired } = pricingService();
    const { profile } = await service.create(STANDARD);
    paired.set(profile.id, [FieldOrderBasis.ODDS, FieldOrderBasis.ODDS]);

    await expect(service.update(profile.id, { ...STANDARD, sources: SEED_FIRST })).rejects.toMatchObject({ code: 'PROFILE_FIRST_SOURCES_DIFFER', statusCode: 422 });
  });
});
