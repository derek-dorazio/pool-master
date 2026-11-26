/**
 * The tier and pricing profile mappers (#1844): every value, the league count and the dates.
 */
import { expect } from '@jest/globals';
import { PlatformPricingProfileDtoSchema, PlatformTierProfileDtoSchema } from '@poolmaster/shared/dto';
import { FieldOrderBasis, PlatformTierProfileLastTier, TierProfileType } from '@poolmaster/shared/domain';
import { toPlatformPricingProfileDto, toPlatformTierProfileDto } from '../../../packages/core-api/src/mappers/profiles.mapper';

const CREATED = new Date('2026-11-18T10:00:00.000Z');
const UPDATED = new Date('2026-11-18T11:30:00.000Z');
const ODDS_FIRST = [FieldOrderBasis.ODDS, FieldOrderBasis.SEED, FieldOrderBasis.RANKING];

describe('profile mappers', () => {
  it('maps a capped tier profile with its cap, league count and dates, as the DTO schema reads it', () => {
    const dto = toPlatformTierProfileDto({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e11', code: 'TIERS_6_OF_10_CAPPED', name: '6 tiers of 10, capped', description: 'A profile for this test.', sources: ODDS_FIRST, type: TierProfileType.EQUAL_GROUPS, tierCount: 6, tierSize: 10,
      lastTier: PlatformTierProfileLastTier.CAPPED, lastTierMax: 15, createdAt: CREATED, updatedAt: UPDATED,
    }, 3);

    expect(dto).toEqual({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e11', code: 'TIERS_6_OF_10_CAPPED', name: '6 tiers of 10, capped', description: 'A profile for this test.', sources: ['ODDS', 'SEED', 'RANKING'], type: 'EQUAL_GROUPS', tierCount: 6, tierSize: 10,
      lastTier: 'CAPPED', lastTierMax: 15, sportLeagueCount: 3,
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T11:30:00.000Z',
    });
    expect(PlatformTierProfileDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('maps a ranges tier profile with its sources and ranges and no equal-groups values, as the DTO schema reads it', () => {
    const ranges = [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }];
    const dto = toPlatformTierProfileDto({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e12', code: 'PLAYOFF_SEEDS_1_4_REST', name: 'Playoff seeds', description: 'A profile for this test.', type: TierProfileType.RANGES,
      sources: [FieldOrderBasis.SEED, FieldOrderBasis.ODDS], ranges, createdAt: CREATED, updatedAt: UPDATED,
    }, 1);

    expect(dto).toEqual({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e12', code: 'PLAYOFF_SEEDS_1_4_REST', name: 'Playoff seeds', description: 'A profile for this test.', type: 'RANGES',
      sources: ['SEED', 'ODDS'], ranges, sportLeagueCount: 1,
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T11:30:00.000Z',
    });
    expect(PlatformTierProfileDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('maps a pricing profile with its five values, league count and dates, as the DTO schema reads it', () => {
    const dto = toPlatformPricingProfileDto({
      id: '0b8f3d0e-21a4-4c55-8f0e-3f6b2b8c7d22', code: 'SMALL', name: 'Small', description: 'A profile for this test.', sources: ODDS_FIRST, salaryCap: 5000, unit: 10,
      topSharePercent: 24, floorSharePercent: 12, steepness: 4, createdAt: CREATED, updatedAt: UPDATED,
    }, 0);

    expect(dto).toEqual({
      id: '0b8f3d0e-21a4-4c55-8f0e-3f6b2b8c7d22', code: 'SMALL', name: 'Small', description: 'A profile for this test.', sources: ['ODDS', 'SEED', 'RANKING'], salaryCap: 5000, unit: 10,
      topSharePercent: 24, floorSharePercent: 12, steepness: 4, sportLeagueCount: 0,
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T11:30:00.000Z',
    });
    expect(PlatformPricingProfileDtoSchema.safeParse(dto).success).toBe(true);
  });
});
