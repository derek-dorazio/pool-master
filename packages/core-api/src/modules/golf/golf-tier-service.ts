/**
 * GolfTierService — event-owned golf tier/price definitions and assignments.
 *
 * Tiers and price are event-level only, never a per-contest override (plans/124
 * §4.6): getEffectiveTiersForContest resolves the contest's SportEvent and
 * reads that event's SportEventGolfTier + SportEventParticipantGolfValuation
 * rows — there is no second, contest-owned tier list to fall back to.
 *
 * getEffectiveValuationsForContest/getEffectiveValuationsForSportEvent are
 * the one shared path every non-tier-editor reader of a golfer's tier/price
 * now goes through — drafts/routes.ts, the admin event browser, and the
 * contest-entry email summary — rather than reading
 * SportEventParticipant.valuations (the legacy table, dropped per plans/124
 * §4.6b) directly. They read SportEventParticipantGolfValuation directly,
 * not derived from the tier-grouped getEffectiveTiersFor* shape, because a
 * valuation can exist with no tier at all (price-only, e.g. a budget-format
 * contest) and would be invisible to any query that starts from
 * SportEventGolfTier.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { GolfTierSource, GolfValuationSource } from '@poolmaster/shared/domain';
import { deriveGolfPrices } from './golf-seeding-algorithm';

export const DEFAULT_TIER_COUNT = 6;
export const DEFAULT_TIER_SIZE = 10;

export class GolfTierError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GolfTierError';
  }
}

export interface GolfTierRow {
  id: string;
  tierKey: string;
  label: string;
  tierNumber: number;
  defaultPickCount: number;
}

export interface GolfTierParticipantRow {
  sportEventParticipantId: string;
  participantId: string;
  tierOrderIndex: number | null;
  price: number | null;
}

export interface GolfTierGroup extends GolfTierRow {
  participants: GolfTierParticipantRow[];
}

/**
 * One golfer's effective tier/price — the shape every non-tier-editor reader
 * actually needs. Read directly off SportEventParticipantGolfValuation, not
 * derived from the tier-grouped shape: a valuation can exist with no tier at
 * all (price-only, e.g. a budget-format contest), and that row would be
 * invisible to any query that starts from SportEventGolfTier. The tier* /
 * price fields are independently nullable — a golfer with only a price has
 * null tier fields, and vice versa.
 */
export interface GolfParticipantValuationRow {
  sportEventParticipantId: string;
  participantId: string;
  tierId: string | null;
  tierKey: string | null;
  tierLabel: string | null;
  tierNumber: number | null;
  tierOrderIndex: number | null;
  price: number | null;
}

interface TierCandidate {
  sportEventParticipantId: string;
  participantId: string;
  odds?: number;
  ranking?: number;
}

export class GolfTierService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Creates DEFAULT_TIER_COUNT (6) tiers for a tournament if none exist yet.
   * Idempotent — a no-op returning the existing rows when the event already
   * has tiers. Tier count is however many rows exist, not a stored parameter
   * (plans/124 §4.5a) — this is a default, fully editable afterward.
   */
  async ensureDefaultGolfTiers(sportEventId: string): Promise<GolfTierRow[]> {
    const existing = await this.prisma.sportEventGolfTier.findMany({
      where: { sportEventId },
      orderBy: { tierNumber: 'asc' },
    });
    if (existing.length > 0) {
      return existing.map(toGolfTierRow);
    }

    const created = await this.prisma.$transaction(
      Array.from({ length: DEFAULT_TIER_COUNT }, (_, index) => {
        const tierNumber = index + 1;
        return this.prisma.sportEventGolfTier.create({
          data: {
            sportEventId,
            tierKey: `tier-${tierNumber}`,
            label: `Tier ${tierNumber}`,
            tierNumber,
            defaultPickCount: 1,
          },
        });
      }),
    );
    this.logger?.info({ sportEventId, tierCount: created.length }, 'Created default golf tiers');
    return created.map(toGolfTierRow);
  }

  /**
   * The one path to a contest's effective tiers: resolve its SportEvent, read
   * that event's tiers + valuations. No contest ever defines its own — see
   * plans/124 §4.6.
   */
  async getEffectiveTiersForContest(contestId: string): Promise<GolfTierGroup[]> {
    const contest = await this.prisma.contest.findUniqueOrThrow({
      where: { id: contestId },
      select: { sportEventId: true },
    });
    if (!contest.sportEventId) {
      return [];
    }
    return this.getEffectiveTiersForSportEvent(contest.sportEventId);
  }

  async getEffectiveTiersForSportEvent(sportEventId: string): Promise<GolfTierGroup[]> {
    const tiers = await this.prisma.sportEventGolfTier.findMany({
      where: { sportEventId },
      orderBy: { tierNumber: 'asc' },
      include: {
        valuations: {
          orderBy: { tierOrderIndex: 'asc' },
          include: {
            sportEventParticipant: { select: { participantId: true } },
          },
        },
      },
    });

    return tiers.map((tier) => ({
      ...toGolfTierRow(tier),
      participants: tier.valuations.map((valuation) => ({
        sportEventParticipantId: valuation.sportEventParticipantId,
        participantId: valuation.sportEventParticipant.participantId,
        tierOrderIndex: valuation.tierOrderIndex,
        price: valuation.price === null ? null : Number(valuation.price),
      })),
    }));
  }

  /**
   * Per-golfer tier/price view for a contest's event — the shape
   * drafts/routes.ts, the admin event browser, and email summaries actually
   * need. Reads SportEventParticipantGolfValuation directly (not derived
   * from getEffectiveTiersForContest's tier-grouped shape) so a price-only
   * valuation with no tier assignment is still included.
   */
  async getEffectiveValuationsForContest(contestId: string): Promise<GolfParticipantValuationRow[]> {
    const contest = await this.prisma.contest.findUniqueOrThrow({
      where: { id: contestId },
      select: { sportEventId: true },
    });
    if (!contest.sportEventId) {
      return [];
    }
    return this.getEffectiveValuationsForSportEvent(contest.sportEventId);
  }

  async getEffectiveValuationsForSportEvent(sportEventId: string): Promise<GolfParticipantValuationRow[]> {
    const valuations = await this.prisma.sportEventParticipantGolfValuation.findMany({
      where: { sportEventParticipant: { sportEventId } },
      include: {
        sportEventParticipant: { select: { participantId: true } },
        sportEventGolfTier: true,
      },
      orderBy: [{ sportEventGolfTier: { tierNumber: 'asc' } }, { tierOrderIndex: 'asc' }],
    });

    return valuations.map((valuation) => ({
      sportEventParticipantId: valuation.sportEventParticipantId,
      participantId: valuation.sportEventParticipant.participantId,
      tierId: valuation.sportEventGolfTier?.id ?? null,
      tierKey: valuation.sportEventGolfTier?.tierKey ?? null,
      tierLabel: valuation.sportEventGolfTier?.label ?? null,
      tierNumber: valuation.sportEventGolfTier?.tierNumber ?? null,
      tierOrderIndex: valuation.tierOrderIndex,
      price: valuation.price === null ? null : Number(valuation.price),
    }));
  }

  /**
   * Sorts the active field by `source`, then walks the event's tiers in
   * tierNumber order assigning exactly `tierSize` golfers to each tier except
   * the last (highest tierNumber), which absorbs everyone else regardless of
   * count. Recomputed fresh from the current tier-row count + tierSize each
   * run — no persisted range to keep in sync (plans/124 §4.5a).
   */
  async autoAssignGolfTiers(input: {
    sportEventId: string;
    source: GolfTierSource;
    tierSize?: number;
  }): Promise<GolfTierGroup[]> {
    const tierSize = input.tierSize ?? DEFAULT_TIER_SIZE;
    const tiers = await this.prisma.sportEventGolfTier.findMany({
      where: { sportEventId: input.sportEventId },
      orderBy: { tierNumber: 'asc' },
    });
    if (tiers.length === 0) {
      this.logger?.warn({ sportEventId: input.sportEventId }, 'Cannot auto-assign golf tiers — event has no tiers yet');
      return [];
    }

    const field = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: input.sportEventId, isActive: true },
      select: { id: true, participantId: true, oddsToWin: true, worldRanking: true },
    });

    const candidates: TierCandidate[] = field.map((participant) => ({
      sportEventParticipantId: participant.id,
      participantId: participant.participantId,
      odds: participant.oddsToWin === null ? undefined : Number(participant.oddsToWin),
      ranking: participant.worldRanking ?? undefined,
    }));
    const ordered = [...candidates].sort((left, right) =>
      compareTierCandidates(left, right, input.source),
    );

    const assignedSource = input.source === GolfTierSource.WORLD_RANK
      ? GolfValuationSource.AUTO_WORLD_RANK
      : GolfValuationSource.AUTO_ODDS;
    const lastTierIndex = tiers.length - 1;

    await this.prisma.$transaction(
      ordered.map((candidate, index) => {
        const orderIndex = index + 1;
        const tierIndex = Math.min(Math.floor(index / tierSize), lastTierIndex);
        const tier = tiers[tierIndex];
        return this.prisma.sportEventParticipantGolfValuation.upsert({
          where: { sportEventParticipantId: candidate.sportEventParticipantId },
          create: {
            sportEventParticipantId: candidate.sportEventParticipantId,
            sportEventGolfTierId: tier.id,
            tierOrderIndex: orderIndex,
            tierAssignedSource: assignedSource,
          },
          update: {
            sportEventGolfTierId: tier.id,
            tierOrderIndex: orderIndex,
            tierAssignedSource: assignedSource,
          },
        });
      }),
    );

    this.logger?.info({
      sportEventId: input.sportEventId,
      source: input.source,
      tierSize,
      assignedCount: ordered.length,
    }, 'Auto-assigned golf tiers');

    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * Full replace of tier definitions. Rejects a change that would orphan
   * assignments (a removed tierKey with valuation rows still pointing at it)
   * unless `reassignOrphansTo` names a tierKey present in the new list.
   */
  async replaceGolfTournamentTiers(input: {
    sportEventId: string;
    tiers: Array<{ tierKey: string; label: string; tierNumber: number; defaultPickCount: number }>;
    reassignOrphansTo?: string;
  }): Promise<GolfTierGroup[]> {
    const existing = await this.prisma.sportEventGolfTier.findMany({
      where: { sportEventId: input.sportEventId },
      include: { valuations: { select: { id: true } } },
    });
    const newTierKeys = new Set(input.tiers.map((tier) => tier.tierKey));
    if (input.reassignOrphansTo && !newTierKeys.has(input.reassignOrphansTo)) {
      throw new GolfTierError(
        `reassignOrphansTo tier "${input.reassignOrphansTo}" is not present in the new tier list.`,
        'REASSIGN_TARGET_TIER_NOT_FOUND',
        422,
      );
    }
    const removedTiers = existing.filter((tier) => !newTierKeys.has(tier.tierKey));
    const orphanedCount = removedTiers.reduce((sum, tier) => sum + tier.valuations.length, 0);
    if (orphanedCount > 0 && !input.reassignOrphansTo) {
      throw new GolfTierError(
        `Removing tier(s) ${removedTiers.map((tier) => tier.tierKey).join(', ')} would orphan ${orphanedCount} assignment(s). Supply reassignOrphansTo to reassign them first.`,
        'TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS',
        409,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Phase 1: move every currently-existing tier's tierNumber out of the
      // way so the (sportEventId, tierNumber) unique index never collides
      // while final numbers are written in phase 2 (two tiers swapping order).
      for (const tier of existing) {
        await tx.sportEventGolfTier.update({
          where: { id: tier.id },
          data: { tierNumber: -(tier.tierNumber + 1) },
        });
      }
      // Phase 2: upsert every tier in the new list to its final shape —
      // every survivor and every brand-new tierKey now has a real row before
      // phase 3 needs to reassign orphaned valuations onto one of them.
      for (const tierInput of input.tiers) {
        await tx.sportEventGolfTier.upsert({
          where: { sportEventId_tierKey: { sportEventId: input.sportEventId, tierKey: tierInput.tierKey } },
          create: { sportEventId: input.sportEventId, ...tierInput },
          update: {
            label: tierInput.label,
            tierNumber: tierInput.tierNumber,
            defaultPickCount: tierInput.defaultPickCount,
          },
        });
      }
      // Phase 3: reassign valuations off any tier being removed, onto the
      // requested target, before that tier is deleted.
      if (removedTiers.length > 0 && input.reassignOrphansTo) {
        const target = await tx.sportEventGolfTier.findUniqueOrThrow({
          where: { sportEventId_tierKey: { sportEventId: input.sportEventId, tierKey: input.reassignOrphansTo } },
        });
        await tx.sportEventParticipantGolfValuation.updateMany({
          where: { sportEventGolfTierId: { in: removedTiers.map((tier) => tier.id) } },
          data: { sportEventGolfTierId: target.id, tierOrderIndex: null },
        });
      }
      // Phase 4: delete tiers no longer in the new set (ON DELETE SET NULL
      // safety-nets any valuation phase 3 didn't reach).
      if (removedTiers.length > 0) {
        await tx.sportEventGolfTier.deleteMany({
          where: { id: { in: removedTiers.map((tier) => tier.id) } },
        });
      }
    });

    this.logger?.info({
      sportEventId: input.sportEventId,
      tierCount: input.tiers.length,
      removedTierCount: removedTiers.length,
      reassignedCount: orphanedCount,
    }, 'Replaced golf tournament tier definitions');

    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * The drag-and-drop save: full desired state, applied in one transaction
   * so a dropped request never leaves a half-moved field. tierAssignedSource
   * is always MANUAL here — auto-assignment is autoAssignGolfTiers' job.
   */
  async replaceGolfTierAssignments(input: {
    sportEventId: string;
    assignments: Array<{ sportEventParticipantId: string; tierKey: string; tierOrderIndex: number }>;
  }): Promise<GolfTierGroup[]> {
    const tiers = await this.prisma.sportEventGolfTier.findMany({
      where: { sportEventId: input.sportEventId },
      select: { id: true, tierKey: true },
    });
    const tierIdByKey = new Map(tiers.map((tier) => [tier.tierKey, tier.id]));
    const unknownTierKeys = Array.from(new Set(
      input.assignments.map((assignment) => assignment.tierKey).filter((tierKey) => !tierIdByKey.has(tierKey)),
    ));
    if (unknownTierKeys.length > 0) {
      throw new GolfTierError(`Unknown tier key(s): ${unknownTierKeys.join(', ')}.`, 'UNKNOWN_TIER_KEY', 422);
    }

    const participantIds = input.assignments.map((assignment) => assignment.sportEventParticipantId);
    const owned = await this.prisma.sportEventParticipant.findMany({
      where: { id: { in: participantIds }, sportEventId: input.sportEventId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((participant) => participant.id));
    const unowned = participantIds.filter((id) => !ownedIds.has(id));
    if (unowned.length > 0) {
      throw new GolfTierError(
        `Field entr${unowned.length === 1 ? 'y' : 'ies'} not found on sport event ${input.sportEventId}: ${unowned.join(', ')}.`,
        'FIELD_ENTRY_NOT_FOUND',
        404,
      );
    }

    await this.prisma.$transaction(
      input.assignments.map((assignment) => {
        const tierId = tierIdByKey.get(assignment.tierKey) as string;
        return this.prisma.sportEventParticipantGolfValuation.upsert({
          where: { sportEventParticipantId: assignment.sportEventParticipantId },
          create: {
            sportEventParticipantId: assignment.sportEventParticipantId,
            sportEventGolfTierId: tierId,
            tierOrderIndex: assignment.tierOrderIndex,
            tierAssignedSource: GolfValuationSource.MANUAL,
          },
          update: {
            sportEventGolfTierId: tierId,
            tierOrderIndex: assignment.tierOrderIndex,
            tierAssignedSource: GolfValuationSource.MANUAL,
          },
        });
      }),
    );

    this.logger?.info({
      sportEventId: input.sportEventId,
      assignedCount: input.assignments.length,
    }, 'Replaced golf tier assignments via manual drag-and-drop save');

    return this.getEffectiveTiersForSportEvent(input.sportEventId);
  }

  /**
   * A separate, later action from field-seeding (plans/124 §4.7a) — uses the
   * field's already-assigned seedNumber as position, not a fresh sort, so
   * price ordering follows the same tie-break that already happened once at
   * seed time. Leaves tier assignments untouched.
   */
  async autoAssignGolfPrices(input: {
    sportEventId: string;
    minPrice: number;
    maxPrice: number;
    random?: () => number;
  }): Promise<GolfParticipantValuationRow[]> {
    const field = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: input.sportEventId, isActive: true, seedNumber: { not: null } },
      select: { id: true, seedNumber: true },
    });
    if (field.length === 0) {
      this.logger?.warn({ sportEventId: input.sportEventId }, 'Cannot auto-assign golf prices — no seeded field participants');
      return [];
    }

    const priced = deriveGolfPrices(
      field.map((participant) => ({ participantId: participant.id, seedNumber: participant.seedNumber as number })),
      input.minPrice,
      input.maxPrice,
      input.random,
    );

    await this.prisma.$transaction(
      priced.map((entry) =>
        this.prisma.sportEventParticipantGolfValuation.upsert({
          where: { sportEventParticipantId: entry.participantId },
          create: {
            sportEventParticipantId: entry.participantId,
            price: entry.price,
            priceAssignedSource: GolfValuationSource.AUTO_ODDS,
          },
          update: {
            price: entry.price,
            priceAssignedSource: GolfValuationSource.AUTO_ODDS,
          },
        }),
      ),
    );

    this.logger?.info({
      sportEventId: input.sportEventId,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      pricedCount: priced.length,
    }, 'Auto-assigned golf prices');

    return this.getEffectiveValuationsForSportEvent(input.sportEventId);
  }
}

function toGolfTierRow(tier: {
  id: string;
  tierKey: string;
  label: string;
  tierNumber: number;
  defaultPickCount: number;
}): GolfTierRow {
  return {
    id: tier.id,
    tierKey: tier.tierKey,
    label: tier.label,
    tierNumber: tier.tierNumber,
    defaultPickCount: tier.defaultPickCount,
  };
}

/** Ported as-is from contest-management/service.ts's derivePersistedTierConfig (deleted). */
function compareTierCandidates(
  left: TierCandidate,
  right: TierCandidate,
  tierSource: GolfTierSource,
): number {
  if (tierSource === GolfTierSource.WORLD_RANK) {
    const rankingDiff = compareNullableNumbers(left.ranking, right.ranking);
    if (rankingDiff !== 0) {
      return rankingDiff;
    }

    const oddsDiff = compareNullableNumbers(left.odds, right.odds);
    if (oddsDiff !== 0) {
      return oddsDiff;
    }
  } else {
    const oddsDiff = compareNullableNumbers(left.odds, right.odds);
    if (oddsDiff !== 0) {
      return oddsDiff;
    }

    const rankingDiff = compareNullableNumbers(left.ranking, right.ranking);
    if (rankingDiff !== 0) {
      return rankingDiff;
    }
  }

  return left.participantId.localeCompare(right.participantId, undefined, {
    sensitivity: 'base',
  });
}

function compareNullableNumbers(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return left - right;
}
