/**
 * Prisma adapters for the tier and pricing profile ports (#1844): platform-level definitions each
 * sport league names one of. A handful of rows each, so every read is the whole table or one row.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  PricingProfileRepository,
  PricingProfileWrite,
  TierProfileRepository,
  TierProfileWrite,
} from '@poolmaster/shared/db';
import type { PricingProfile, TierProfile } from '@poolmaster/shared/domain';

type TierProfileRow = Prisma.TierProfileGetPayload<object>;
type PricingProfileRow = Prisma.PricingProfileGetPayload<object>;

function toTierProfile(row: TierProfileRow): TierProfile {
  return {
    id: row.id,
    name: row.name,
    tierCount: row.tierCount,
    tierSize: row.tierSize,
    lastTier: row.lastTier,
    lastTierMax: row.lastTierMax,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPricingProfile(row: PricingProfileRow): PricingProfile {
  return {
    id: row.id,
    name: row.name,
    salaryCap: row.salaryCap,
    unit: row.unit,
    topSharePercent: row.topSharePercent,
    floorSharePercent: row.floorSharePercent,
    steepness: row.steepness,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Deletes a profile in one statement, letting the database say why it can't: a sport league's
 * foreign key (P2003) answers how many leagues name it, and no such row (P2025) answers null.
 * Asking first would leave a window for a league to name the profile between the count and the
 * delete; the foreign key closes it.
 */
async function deleteUnlessUsed(remove: () => Promise<unknown>, countUses: () => Promise<number>): Promise<number | null> {
  try {
    await remove();
    return 0;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    if (error.code === 'P2025') return null;
    if (error.code === 'P2003') return countUses();
    throw error;
  }
}

export class PrismaTierProfileRepository implements TierProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<TierProfile[]> {
    return (await this.prisma.tierProfile.findMany({ orderBy: { name: 'asc' } })).map(toTierProfile);
  }

  async findById(id: string): Promise<TierProfile | null> {
    const row = await this.prisma.tierProfile.findUnique({ where: { id } });
    return row ? toTierProfile(row) : null;
  }

  async findByName(name: string): Promise<TierProfile | null> {
    const row = await this.prisma.tierProfile.findUnique({ where: { name } });
    return row ? toTierProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<TierProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { tierProfile: true } });
    return row ? toTierProfile(row.tierProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['tierProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.tierProfileId, group._count._all]));
  }

  async create(input: TierProfileWrite): Promise<TierProfile> {
    return toTierProfile(await this.prisma.tierProfile.create({ data: tierProfileData(input) }));
  }

  async update(id: string, input: TierProfileWrite): Promise<TierProfile> {
    return toTierProfile(await this.prisma.tierProfile.update({ where: { id }, data: tierProfileData(input) }));
  }

  async deleteUnlessUsed(id: string): Promise<number | null> {
    return deleteUnlessUsed(
      () => this.prisma.tierProfile.delete({ where: { id }, select: { id: true } }),
      () => this.prisma.sportLeague.count({ where: { tierProfileId: id } }),
    );
  }
}

export class PrismaPricingProfileRepository implements PricingProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<PricingProfile[]> {
    return (await this.prisma.pricingProfile.findMany({ orderBy: { name: 'asc' } })).map(toPricingProfile);
  }

  async findById(id: string): Promise<PricingProfile | null> {
    const row = await this.prisma.pricingProfile.findUnique({ where: { id } });
    return row ? toPricingProfile(row) : null;
  }

  async findByName(name: string): Promise<PricingProfile | null> {
    const row = await this.prisma.pricingProfile.findUnique({ where: { name } });
    return row ? toPricingProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<PricingProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { pricingProfile: true } });
    return row ? toPricingProfile(row.pricingProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['pricingProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.pricingProfileId, group._count._all]));
  }

  async create(input: PricingProfileWrite): Promise<PricingProfile> {
    return toPricingProfile(await this.prisma.pricingProfile.create({ data: pricingProfileData(input) }));
  }

  async update(id: string, input: PricingProfileWrite): Promise<PricingProfile> {
    return toPricingProfile(await this.prisma.pricingProfile.update({ where: { id }, data: pricingProfileData(input) }));
  }

  async deleteUnlessUsed(id: string): Promise<number | null> {
    return deleteUnlessUsed(
      () => this.prisma.pricingProfile.delete({ where: { id }, select: { id: true } }),
      () => this.prisma.sportLeague.count({ where: { pricingProfileId: id } }),
    );
  }
}

function tierProfileData(input: TierProfileWrite): Prisma.TierProfileUncheckedCreateInput {
  return {
    name: input.name,
    tierCount: input.tierCount,
    tierSize: input.tierSize,
    lastTier: input.lastTier,
    lastTierMax: input.lastTierMax,
  };
}

function pricingProfileData(input: PricingProfileWrite): Prisma.PricingProfileUncheckedCreateInput {
  return {
    name: input.name,
    salaryCap: input.salaryCap,
    unit: input.unit,
    topSharePercent: input.topSharePercent,
    floorSharePercent: input.floorSharePercent,
    steepness: input.steepness,
  };
}
