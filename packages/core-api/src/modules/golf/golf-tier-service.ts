/**
 * GolfTierService — event-owned golf tier/price definitions and assignments.
 *
 * Tiers and price are event-level only, never a per-contest override (plans/124
 * §4.6): getEffectiveTiersForContest resolves the contest's SportEvent and
 * reads that event's SportEventGolfTier + SportEventParticipantGolfValuation
 * rows — there is no second, contest-owned tier list to fall back to.
 *
 * Not yet wired to any route or the live draft room. drafts/routes.ts still
 * reads the legacy SportEventParticipantValuation table (plans/124 §4.5/§4.6b)
 * until that rewiring lands in a later slice.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { GolfTierSource, GolfValuationSource } from '@poolmaster/shared/domain';

export const DEFAULT_TIER_COUNT = 6;
export const DEFAULT_TIER_SIZE = 10;

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
}

export interface GolfTierGroup extends GolfTierRow {
  participants: GolfTierParticipantRow[];
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
      })),
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
