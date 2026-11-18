import { expect } from '@jest/globals';
import type { ProfileRepository } from '@poolmaster/shared/db';
import { TierProfileLastTier, type PricingProfile, type TierProfile } from '@poolmaster/shared/domain';
import {
  PRICING_PROFILE_KIND,
  ProfileService,
  TIER_PROFILE_KIND,
} from '../../../packages/core-api/src/modules/profiles/profile-service';
import { fakeLogger } from '../../support/fake-logger';

// The root admin's tier and pricing profiles (#1844): one service for both kinds, against an
// in-memory repository. What the adapters do with a write is asserted against Postgres in
// profile-repositories.integration.

const T0 = new Date('2026-01-01T00:00:00.000Z');

type TierWrite = Omit<TierProfile, 'id' | 'createdAt' | 'updatedAt'>;
type PricingWrite = Omit<PricingProfile, 'id' | 'createdAt' | 'updatedAt'>;

const SIX_OF_TEN: TierWrite = { name: '6 tiers of 10', tierCount: 6, tierSize: 10, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null };
const STANDARD: PricingWrite = { name: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

/** Profiles in a list, each league naming one by id in `uses`. */
function memoryProfiles<TProfile extends { id: string; name: string }, TWrite extends { name: string }>(
  build: (id: string, write: TWrite) => TProfile,
) {
  const rows: TProfile[] = [];
  const uses = new Map<string, number>();
  let sequence = 0;
  const repo: ProfileRepository<TProfile, TWrite> = {
    findAll: async () => [...rows].sort((left, right) => left.name.localeCompare(right.name)),
    findById: async (id) => rows.find((row) => row.id === id) ?? null,
    findByName: async (name) => rows.find((row) => row.name === name) ?? null,
    findBySportLeague: async () => null,
    countSportLeagues: async () => new Map(uses),
    create: async (write) => {
      const row = build(`profile-${++sequence}`, write);
      rows.push(row);
      return row;
    },
    update: async (id, write) => {
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
  return { repo, rows, uses };
}

function tierService() {
  const store = memoryProfiles<TierProfile, TierWrite>((id, write) => ({ id, ...write, createdAt: T0, updatedAt: T0 }));
  const logger = fakeLogger();
  return { ...store, logger, service: new ProfileService({ profiles: store.repo, kind: TIER_PROFILE_KIND, logger }) };
}

function pricingService() {
  const store = memoryProfiles<PricingProfile, PricingWrite>((id, write) => ({ id, ...write, createdAt: T0, updatedAt: T0 }));
  return { ...store, service: new ProfileService({ profiles: store.repo, kind: PRICING_PROFILE_KIND }) };
}

describe('ProfileService — tier profiles', () => {
  it('creates a profile with no sport league naming it yet, and lists every profile by name with how many leagues name each', async () => {
    const { service, uses } = tierService();
    const created = await service.create(SIX_OF_TEN);
    await service.create({ ...SIX_OF_TEN, name: '4 tiers of 16', tierCount: 4, tierSize: 16 });
    uses.set(created.profile.id, 3);

    expect(created.sportLeagueCount).toBe(0);
    expect((await service.list()).map(({ profile, sportLeagueCount }) => [profile.name, sportLeagueCount])).toEqual([
      ['4 tiers of 16', 0],
      ['6 tiers of 10', 3],
    ]);
  });

  it('reads one profile with its league count, and answers an unknown one with 404 TIER_PROFILE_NOT_FOUND', async () => {
    const { service, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 2);

    await expect(service.get(profile.id)).resolves.toMatchObject({ profile: { name: '6 tiers of 10' }, sportLeagueCount: 2 });
    await expect(service.get('profile-gone')).rejects.toMatchObject({ code: 'TIER_PROFILE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses a capped last tier with no maximum, or a maximum on one that takes everyone left, with 422 TIER_PROFILE_INVALID, creating nothing', async () => {
    const { service, rows } = tierService();

    await expect(service.create({ ...SIX_OF_TEN, lastTier: TierProfileLastTier.CAPPED }))
      .rejects.toMatchObject({ code: 'TIER_PROFILE_INVALID', statusCode: 422 });
    await expect(service.create({ ...SIX_OF_TEN, lastTierMax: 12 }))
      .rejects.toMatchObject({ code: 'TIER_PROFILE_INVALID', statusCode: 422 });
    expect(rows).toEqual([]);
  });

  it('refuses a second profile with a name already taken with 409 TIER_PROFILE_NAME_TAKEN', async () => {
    const { service, rows } = tierService();
    await service.create(SIX_OF_TEN);

    await expect(service.create({ ...SIX_OF_TEN, tierSize: 8 })).rejects.toMatchObject({ code: 'TIER_PROFILE_NAME_TAKEN', statusCode: 409 });
    expect(rows).toHaveLength(1);
  });

  it('replaces a profile\'s name and layout, keeping its own name free to reuse, and answers it with its league count', async () => {
    const { service, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 5);

    const updated = await service.update(profile.id, { ...SIX_OF_TEN, lastTier: TierProfileLastTier.CAPPED, lastTierMax: 15 });

    expect(updated).toMatchObject({ profile: { id: profile.id, name: '6 tiers of 10', lastTier: 'CAPPED', lastTierMax: 15 }, sportLeagueCount: 5 });
  });

  it('refuses an update to an unknown profile (404), to bad values (422), or to another profile\'s name (409), changing nothing', async () => {
    const { service, rows } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    await service.create({ ...SIX_OF_TEN, name: 'Other' });

    await expect(service.update('profile-gone', SIX_OF_TEN)).rejects.toMatchObject({ code: 'TIER_PROFILE_NOT_FOUND', statusCode: 404 });
    await expect(service.update(profile.id, { ...SIX_OF_TEN, lastTier: TierProfileLastTier.CAPPED })).rejects.toMatchObject({ code: 'TIER_PROFILE_INVALID', statusCode: 422 });
    await expect(service.update(profile.id, { ...SIX_OF_TEN, name: 'Other' })).rejects.toMatchObject({ code: 'TIER_PROFILE_NAME_TAKEN', statusCode: 409 });
    expect(rows.find((row) => row.id === profile.id)).toMatchObject(SIX_OF_TEN);
  });

  it('deletes a profile no sport league names', async () => {
    const { service, rows, logger } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);

    await service.delete(profile.id);

    expect(rows).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ profileId: profile.id }), 'Deleted profile');
  });

  it('refuses to delete a profile any sport league names with 409 TIER_PROFILE_IN_USE, saying how many, and keeps it', async () => {
    const { service, rows, uses } = tierService();
    const { profile } = await service.create(SIX_OF_TEN);
    uses.set(profile.id, 2);

    await expect(service.delete(profile.id)).rejects.toMatchObject({
      code: 'TIER_PROFILE_IN_USE', statusCode: 409, message: expect.stringContaining('named by 2 sport leagues'),
    });
    uses.set(profile.id, 1);
    await expect(service.delete(profile.id)).rejects.toMatchObject({ message: expect.stringContaining('named by 1 sport league,') });
    expect(rows).toHaveLength(1);
  });

  it('answers a delete of an unknown profile with 404 TIER_PROFILE_NOT_FOUND', async () => {
    const { service } = tierService();

    await expect(service.delete('profile-gone')).rejects.toMatchObject({ code: 'TIER_PROFILE_NOT_FOUND', statusCode: 404 });
  });
});

describe('ProfileService — pricing profiles', () => {
  it('creates a pricing profile and refuses one whose floor share is above its top share with 422 PRICING_PROFILE_INVALID', async () => {
    const { service, rows } = pricingService();

    await expect(service.create(STANDARD)).resolves.toMatchObject({ profile: STANDARD, sportLeagueCount: 0 });
    await expect(service.create({ ...STANDARD, name: 'Upside down', floorSharePercent: 30 }))
      .rejects.toMatchObject({ code: 'PRICING_PROFILE_INVALID', statusCode: 422 });
    expect(rows).toHaveLength(1);
  });

  it('answers pricing profiles\' own codes: 409 PRICING_PROFILE_NAME_TAKEN, 404 PRICING_PROFILE_NOT_FOUND and 409 PRICING_PROFILE_IN_USE', async () => {
    const { service, uses } = pricingService();
    const { profile } = await service.create(STANDARD);
    uses.set(profile.id, 1);

    await expect(service.create(STANDARD)).rejects.toMatchObject({ code: 'PRICING_PROFILE_NAME_TAKEN', statusCode: 409 });
    await expect(service.get('profile-gone')).rejects.toMatchObject({ code: 'PRICING_PROFILE_NOT_FOUND', statusCode: 404 });
    await expect(service.delete(profile.id)).rejects.toMatchObject({ code: 'PRICING_PROFILE_IN_USE', statusCode: 409 });
  });
});
