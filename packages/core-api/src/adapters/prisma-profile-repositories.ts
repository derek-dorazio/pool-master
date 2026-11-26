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
import { TierProfileType, type FieldOrderBasis, type PlatformPricingProfile, type PlatformTierProfile } from '@poolmaster/shared/domain';

/** A profile's sources in list order, and a tier profile's ranges by tier: every read loads them with the profile. */
const SOURCES_IN_ORDER = { orderBy: { orderIndex: 'asc' }, select: { basis: true } } as const;
const TIER_PROFILE_INCLUDE = {
  sources: SOURCES_IN_ORDER,
  ranges: { orderBy: { tierNumber: 'asc' }, select: { tierNumber: true, fromValue: true, toValue: true } },
} as const satisfies Prisma.PlatformTierProfileInclude;
const PRICING_PROFILE_INCLUDE = { sources: SOURCES_IN_ORDER } as const satisfies Prisma.PlatformPricingProfileInclude;
/** The first source of a profile, for the first-source check across a league's two profiles. */
const FIRST_SOURCE = { where: { orderIndex: 0 }, select: { basis: true } } as const;

type PlatformTierProfileRow = Prisma.PlatformTierProfileGetPayload<{ include: typeof TIER_PROFILE_INCLUDE }>;
type PlatformPricingProfileRow = Prisma.PlatformPricingProfileGetPayload<{ include: typeof PRICING_PROFILE_INCLUDE }>;

/**
 * A tier profile row as the domain's layout union. The database check keeps the EQUAL_GROUPS
 * columns set exactly on EQUAL_GROUPS rows, so a null among them is a broken row.
 */
function toPlatformTierProfile(row: PlatformTierProfileRow): PlatformTierProfile {
  const identity = {
    id: row.id,
    code: row.code,
    name: row.name,
    sources: row.sources.map(({ basis }) => basis),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.type === TierProfileType.RANGES) {
    return { ...identity, type: TierProfileType.RANGES, ranges: row.ranges };
  }
  if (row.tierCount === null || row.tierSize === null || row.lastTier === null) {
    throw new Error(`Tier profile ${row.id} is EQUAL_GROUPS without its tier count, size or last tier.`);
  }
  return {
    ...identity,
    type: TierProfileType.EQUAL_GROUPS,
    tierCount: row.tierCount,
    tierSize: row.tierSize,
    lastTier: row.lastTier,
    lastTierMax: row.lastTierMax,
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
    sources: row.sources.map(({ basis }) => basis),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A source list as its rows, each at its place. */
function sourceRows(sources: readonly FieldOrderBasis[]): Array<{ orderIndex: number; basis: FieldOrderBasis }> {
  return sources.map((basis, orderIndex) => ({ orderIndex, basis }));
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
    return (await this.prisma.platformTierProfile.findMany({ orderBy: { name: 'asc' }, include: TIER_PROFILE_INCLUDE })).map(toPlatformTierProfile);
  }

  async findById(id: string): Promise<PlatformTierProfile | null> {
    const row = await this.prisma.platformTierProfile.findUnique({ where: { id }, include: TIER_PROFILE_INCLUDE });
    return row ? toPlatformTierProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<PlatformTierProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { platformTierProfile: { include: TIER_PROFILE_INCLUDE } } });
    return row ? toPlatformTierProfile(row.platformTierProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['platformTierProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.platformTierProfileId, group._count._all]));
  }

  async countSportLeaguesNaming(id: string): Promise<number> {
    return this.prisma.sportLeague.count({ where: { platformTierProfileId: id } });
  }

  async findPairedFirstSources(id: string): Promise<FieldOrderBasis[]> {
    const leagues = await this.prisma.sportLeague.findMany({
      where: { platformTierProfileId: id },
      select: { platformPricingProfile: { select: { sources: FIRST_SOURCE } } },
    });
    return leagues.flatMap((league) => league.platformPricingProfile.sources.map(({ basis }) => basis));
  }

  async create(input: PlatformTierProfileWrite): Promise<PlatformTierProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformTierProfile(await this.prisma.platformTierProfile.create({
      data: { ...platformTierProfileData(input), sources: { create: sourceRows(input.sources) }, ranges: { create: rangeRows(input) } },
      include: TIER_PROFILE_INCLUDE,
    })));
  }

  async update(id: string, input: PlatformTierProfileWrite): Promise<PlatformTierProfile | ProfileTaken> {
    // One nested write: the profile, its sources and its ranges are replaced together or not at all.
    return unlessTaken(async () => toPlatformTierProfile(await this.prisma.platformTierProfile.update({
      where: { id },
      data: {
        ...platformTierProfileData(input),
        sources: { deleteMany: {}, create: sourceRows(input.sources) },
        ranges: { deleteMany: {}, create: rangeRows(input) },
      },
      include: TIER_PROFILE_INCLUDE,
    })));
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
    return (await this.prisma.platformPricingProfile.findMany({ orderBy: { name: 'asc' }, include: PRICING_PROFILE_INCLUDE })).map(toPlatformPricingProfile);
  }

  async findById(id: string): Promise<PlatformPricingProfile | null> {
    const row = await this.prisma.platformPricingProfile.findUnique({ where: { id }, include: PRICING_PROFILE_INCLUDE });
    return row ? toPlatformPricingProfile(row) : null;
  }

  async findBySportLeague(sportLeagueId: string): Promise<PlatformPricingProfile | null> {
    const row = await this.prisma.sportLeague.findUnique({ where: { id: sportLeagueId }, select: { platformPricingProfile: { include: PRICING_PROFILE_INCLUDE } } });
    return row ? toPlatformPricingProfile(row.platformPricingProfile) : null;
  }

  async countSportLeagues(): Promise<Map<string, number>> {
    const groups = await this.prisma.sportLeague.groupBy({ by: ['platformPricingProfileId'], _count: { _all: true } });
    return new Map(groups.map((group) => [group.platformPricingProfileId, group._count._all]));
  }

  async countSportLeaguesNaming(id: string): Promise<number> {
    return this.prisma.sportLeague.count({ where: { platformPricingProfileId: id } });
  }

  async findPairedFirstSources(id: string): Promise<FieldOrderBasis[]> {
    const leagues = await this.prisma.sportLeague.findMany({
      where: { platformPricingProfileId: id },
      select: { platformTierProfile: { select: { sources: FIRST_SOURCE } } },
    });
    return leagues.flatMap((league) => league.platformTierProfile.sources.map(({ basis }) => basis));
  }

  async create(input: PlatformPricingProfileWrite): Promise<PlatformPricingProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformPricingProfile(await this.prisma.platformPricingProfile.create({
      data: { ...platformPricingProfileData(input), sources: { create: sourceRows(input.sources) } },
      include: PRICING_PROFILE_INCLUDE,
    })));
  }

  async update(id: string, input: PlatformPricingProfileWrite): Promise<PlatformPricingProfile | ProfileTaken> {
    return unlessTaken(async () => toPlatformPricingProfile(await this.prisma.platformPricingProfile.update({
      where: { id },
      data: { ...platformPricingProfileData(input), sources: { deleteMany: {}, create: sourceRows(input.sources) } },
      include: PRICING_PROFILE_INCLUDE,
    })));
  }

  async deleteUnlessUsed(id: string): Promise<number | null> {
    return deleteUnlessUsed(
      () => this.prisma.platformPricingProfile.delete({ where: { id }, select: { id: true } }),
      () => this.countSportLeaguesNaming(id),
    );
  }
}

/** The profile's own columns: the EQUAL_GROUPS ones set on EQUAL_GROUPS, null on RANGES (the database check). */
function platformTierProfileData(input: PlatformTierProfileWrite) {
  const equalGroups = input.type === TierProfileType.EQUAL_GROUPS
    ? { tierCount: input.tierCount, tierSize: input.tierSize, lastTier: input.lastTier, lastTierMax: input.lastTierMax }
    : { tierCount: null, tierSize: null, lastTier: null, lastTierMax: null };
  return { code: input.code, name: input.name, type: input.type, ...equalGroups };
}

/** A RANGES profile's ranges as rows; an EQUAL_GROUPS profile has none. */
function rangeRows(input: PlatformTierProfileWrite): Array<{ tierNumber: number; fromValue: number; toValue: number | null }> {
  return input.type === TierProfileType.RANGES
    ? input.ranges.map(({ tierNumber, fromValue, toValue }) => ({ tierNumber, fromValue, toValue }))
    : [];
}

function platformPricingProfileData(input: PlatformPricingProfileWrite) {
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
