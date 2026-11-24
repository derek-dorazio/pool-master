/**
 * Prisma adapters for the tier and pricing profile ports (#1844): platform-level definitions each
 * sport league names one of. A handful of rows each, so every read is the whole table or one row.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  PlatformPricingProfileRepository,
  PlatformPricingProfileWrite,
  PlatformTierProfileRepository,
  PlatformTierProfileWrite,
  ProfileTaken,
} from '@poolmaster/shared/db';
import type { PlatformPricingProfile, PlatformTierProfile } from '@poolmaster/shared/domain';

type PlatformTierProfileRow = Prisma.PlatformTierProfileGetPayload<object>;
type PlatformPricingProfileRow = Prisma.PlatformPricingProfileGetPayload<object>;

function toPlatformTierProfile(row: PlatformTierProfileRow): PlatformTierProfile {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tierCount: row.tierCount,
    tierSize: row.tierSize,
    lastTier: row.lastTier,
    lastTierMax: row.lastTierMax,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPlatformPricingProfile(row: PlatformPricingProfileRow): PlatformPricingProfile {
  return {
    id: row.id,
    code: row.code,
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

/**
 * Runs a create or update, answering which unique index (P2002) refused it: `'codeTaken'` for the
 * code's, `'nameTaken'` for the name's. Two writes racing for one code or name both pass a
 * read-first check, so the index decides.
 */
async function unlessTaken<T>(write: () => Promise<T>): Promise<T | ProfileTaken> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Prisma names the refused unique index's columns as the error's target.
      return String(error.meta?.['target']).includes('code') ? 'codeTaken' : 'nameTaken';
    }
    throw error;
  }
}

export class PrismaPlatformTierProfileRepository implements PlatformTierProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<PlatformTierProfile[]> {
    return (await this.prisma.platformTierProfile.findMany({ orderBy: { name: 'asc' } })).map(toPlatformTierProfile);
  }

  async findById(id: string): Promise<PlatformTierProfile | null> {
    const row = await this.prisma.platformTierProfile.findUnique({ where: { id } });
    return row ? toPlatformTierProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<PlatformTierProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { platformTierProfile: true } });
    return row ? toPlatformTierProfile(row.platformTierProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['platformTierProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.platformTierProfileId, group._count._all]));
  }

  async countSportLeaguesNaming(id: string): Promise<number> {
    return this.prisma.sportLeague.count({ where: { platformTierProfileId: id } });
  }

  async create(input: PlatformTierProfileWrite): Promise<PlatformTierProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformTierProfile(await this.prisma.platformTierProfile.create({ data: platformTierProfileData(input) })));
  }

  async update(id: string, input: PlatformTierProfileWrite): Promise<PlatformTierProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformTierProfile(await this.prisma.platformTierProfile.update({ where: { id }, data: platformTierProfileData(input) })));
  }

  async deleteUnlessUsed(id: string): Promise<number | null> {
    return deleteUnlessUsed(
      () => this.prisma.platformTierProfile.delete({ where: { id }, select: { id: true } }),
      () => this.countSportLeaguesNaming(id),
    );
  }
}

export class PrismaPlatformPricingProfileRepository implements PlatformPricingProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(): Promise<PlatformPricingProfile[]> {
    return (await this.prisma.platformPricingProfile.findMany({ orderBy: { name: 'asc' } })).map(toPlatformPricingProfile);
  }

  async findById(id: string): Promise<PlatformPricingProfile | null> {
    const row = await this.prisma.platformPricingProfile.findUnique({ where: { id } });
    return row ? toPlatformPricingProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<PlatformPricingProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { platformPricingProfile: true } });
    return row ? toPlatformPricingProfile(row.platformPricingProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['platformPricingProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.platformPricingProfileId, group._count._all]));
  }

  async countSportLeaguesNaming(id: string): Promise<number> {
    return this.prisma.sportLeague.count({ where: { platformPricingProfileId: id } });
  }

  async create(input: PlatformPricingProfileWrite): Promise<PlatformPricingProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformPricingProfile(await this.prisma.platformPricingProfile.create({ data: platformPricingProfileData(input) })));
  }

  async update(id: string, input: PlatformPricingProfileWrite): Promise<PlatformPricingProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformPricingProfile(await this.prisma.platformPricingProfile.update({ where: { id }, data: platformPricingProfileData(input) })));
  }

  async deleteUnlessUsed(id: string): Promise<number | null> {
    return deleteUnlessUsed(
      () => this.prisma.platformPricingProfile.delete({ where: { id }, select: { id: true } }),
      () => this.countSportLeaguesNaming(id),
    );
  }
}

function platformTierProfileData(input: PlatformTierProfileWrite): Prisma.PlatformTierProfileUncheckedCreateInput {
  return {
    code: input.code,
    name: input.name,
    tierCount: input.tierCount,
    tierSize: input.tierSize,
    lastTier: input.lastTier,
    lastTierMax: input.lastTierMax,
  };
}

function platformPricingProfileData(input: PlatformPricingProfileWrite): Prisma.PlatformPricingProfileUncheckedCreateInput {
  return {
    code: input.code,
    name: input.name,
    salaryCap: input.salaryCap,
    unit: input.unit,
    topSharePercent: input.topSharePercent,
    floorSharePercent: input.floorSharePercent,
    steepness: input.steepness,
  };
}
