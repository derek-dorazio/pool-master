/**
 * The tier and pricing profile mappers (#1844): every value, the league count and the dates.
 */
import { expect } from '@jest/globals';
import { PricingProfileDtoSchema, TierProfileDtoSchema } from '@poolmaster/shared/dto';
import { TierProfileLastTier } from '@poolmaster/shared/domain';
import { toPricingProfileDto, toTierProfileDto } from '../../../packages/core-api/src/mappers/profiles.mapper';

const CREATED = new Date('2026-11-18T10:00:00.000Z');
const UPDATED = new Date('2026-11-18T11:30:00.000Z');

describe('profile mappers', () => {
  it('maps a capped tier profile with its cap, league count and dates, as the DTO schema reads it', () => {
    const dto = toTierProfileDto({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e11', name: '6 tiers of 10, capped', tierCount: 6, tierSize: 10,
      lastTier: TierProfileLastTier.CAPPED, lastTierMax: 15, createdAt: CREATED, updatedAt: UPDATED,
    }, 3);

    expect(dto).toEqual({
      id: '6f7a2a52-8b1f-4c43-9a87-0d7d1c2a9e11', name: '6 tiers of 10, capped', tierCount: 6, tierSize: 10,
      lastTier: 'CAPPED', lastTierMax: 15, sportLeagueCount: 3,
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T11:30:00.000Z',
    });
    expect(TierProfileDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('maps a pricing profile with its five values, league count and dates, as the DTO schema reads it', () => {
    const dto = toPricingProfileDto({
      id: '0b8f3d0e-21a4-4c55-8f0e-3f6b2b8c7d22', name: 'Small', salaryCap: 5000, unit: 10,
      topSharePercent: 24, floorSharePercent: 12, steepness: 4, createdAt: CREATED, updatedAt: UPDATED,
    }, 0);

    expect(dto).toEqual({
      id: '0b8f3d0e-21a4-4c55-8f0e-3f6b2b8c7d22', name: 'Small', salaryCap: 5000, unit: 10,
      topSharePercent: 24, floorSharePercent: 12, steepness: 4, sportLeagueCount: 0,
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T11:30:00.000Z',
    });
    expect(PricingProfileDtoSchema.safeParse(dto).success).toBe(true);
  });
});
