/**
 * PricingAndTierService — orchestrates pricing calculation and tier assignment
 * for contest participant pools.
 */

import type {
  ContestPoolRepository,
  ContestParticipantPoolRepository,
  ParticipantRepository,
  ParticipantSeasonRecordRepository,
} from '@poolmaster/shared/db';
import type {
  ContestPool,
  PricingConfig,
  TierConfig,
} from '@poolmaster/shared/domain';
import { calculatePrices, type ParticipantPricingInput } from './pricing-engine';
import { assignTiers, type TierableParticipant } from './tier-engine';

// --- Default pricing config ---

// --- Service ---

export class PricingAndTierService {
  constructor(
    private readonly poolRepo: ContestPoolRepository,
    private readonly poolParticipantRepo: ContestParticipantPoolRepository,
    private readonly seasonRecordRepo: ParticipantSeasonRecordRepository,
    private readonly participantRepo: ParticipantRepository,
  ) {}

  /**
   * Calculates and applies prices to all participants in a contest pool.
   * Updates the cost field on each pool participant record.
   */
  async calculateAndApplyPrices(
    contestId: string,
    config: PricingConfig,
  ): Promise<{ updated: number }> {
    const pool = await this.requirePool(contestId);
    if (pool.poolLocked) throw new PricingLockedError(contestId);

    const poolParticipants = await this.poolParticipantRepo.findByPool(pool.id);
    if (poolParticipants.length === 0) return { updated: 0 };

    const signals = await this.buildParticipantSignals(poolParticipants);
    const inputs: ParticipantPricingInput[] = signals.map((signal) => ({
      participantId: signal.participantId,
      ranking: signal.effectiveRanking,
      formRating: signal.formRating,
      seed: signal.seed,
      oddsImpliedProb: signal.oddsImpliedProb,
    }));

    const prices = calculatePrices(inputs, config);

    // Apply prices to pool participants
    let updated = 0;
    for (const price of prices) {
      const pp = poolParticipants.find((p) => p.participantId === price.participantId);
      if (pp) {
        await this.poolParticipantRepo.update(pp.id, { cost: price.price });
        updated++;
      }
    }

    return { updated };
  }

  /**
   * Applies a manual price override for a specific participant.
   */
  async applyPriceOverride(
    contestId: string,
    participantId: string,
    price: number,
    _reason: string,
    _setBy: string,
  ): Promise<void> {
    const pool = await this.requirePool(contestId);
    if (pool.poolLocked) throw new PricingLockedError(contestId);

    const poolParticipants = await this.poolParticipantRepo.findByContest(contestId);
    const pp = poolParticipants.find((p) => p.participantId === participantId);
    if (!pp) throw new ParticipantNotInPoolForPricingError(contestId, participantId);

    await this.poolParticipantRepo.update(pp.id, { cost: price });
  }

  /**
   * Runs tier auto-assignment and updates pool participant tier fields.
   */
  async assignAndApplyTiers(
    contestId: string,
    config: TierConfig,
  ): Promise<{ assigned: number }> {
    const pool = await this.requirePool(contestId);
    if (pool.poolLocked) throw new PricingLockedError(contestId);

    const poolParticipants = await this.poolParticipantRepo.findByPool(pool.id);
    if (poolParticipants.length === 0) return { assigned: 0 };

    const tierableParticipants: TierableParticipant[] = [];
    const signals = await this.buildParticipantSignals(poolParticipants);

    for (const signal of signals) {
      const pp = poolParticipants.find((entry) => entry.participantId === signal.participantId);
      tierableParticipants.push({
        participantId: signal.participantId,
        ranking: signal.effectiveRanking,
        price: pp?.cost ?? signal.budgetPrice,
        seed: signal.seed,
        odds: signal.oddsSortValue,
      });
    }

    const assignments = assignTiers(tierableParticipants, config);

    // Apply tier assignments to pool participants
    let assigned = 0;
    for (const assignment of assignments) {
      const pp = poolParticipants.find((p) => p.participantId === assignment.participantId);
      if (pp) {
        await this.poolParticipantRepo.update(pp.id, { tier: assignment.tierId });
        assigned++;
      }
    }

    return { assigned };
  }

  /**
   * Manually moves a participant to a different tier.
   */
  async moveParticipantTier(
    contestId: string,
    participantId: string,
    tierId: string,
  ): Promise<void> {
    const pool = await this.requirePool(contestId);
    if (pool.poolLocked) throw new PricingLockedError(contestId);

    const poolParticipants = await this.poolParticipantRepo.findByContest(contestId);
    const pp = poolParticipants.find((p) => p.participantId === participantId);
    if (!pp) throw new ParticipantNotInPoolForPricingError(contestId, participantId);

    await this.poolParticipantRepo.update(pp.id, { tier: tierId });
  }

  private async requirePool(contestId: string): Promise<ContestPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundForPricingError(contestId);
    return pool;
  }

  private async buildParticipantSignals(
    poolParticipants: Array<{ participantId: string; ranking?: number }>,
  ): Promise<ResolvedParticipantSignals[]> {
    const season = getCurrentSeason();
    const signals: ResolvedParticipantSignals[] = [];

    for (const pp of poolParticipants) {
      const seasonRecord = await this.seasonRecordRepo.findByParticipantAndSeason(
        pp.participantId,
        season,
      );
      const participant = await this.participantRepo.findById(pp.participantId);
      const derived = deriveParticipantSignals(participant?.metadata, seasonRecord);
      signals.push({
        participantId: pp.participantId,
        ranking: pp.ranking ?? derived.ranking,
        formRating: seasonRecord ? Number(seasonRecord.formRating) : 50,
        seed: derived.seed,
        budgetPrice: derived.budgetPrice,
        oddsImpliedProb: derived.oddsImpliedProb,
        oddsSortValue: derived.oddsSortValue,
      });
    }

    const effectiveRankings = buildEffectiveRankings(signals);
    return signals.map((signal) => ({
      ...signal,
      effectiveRanking: effectiveRankings.get(signal.participantId),
    }));
  }
}

interface ResolvedParticipantSignals extends DerivedParticipantSignals {
  participantId: string;
  formRating: number;
  effectiveRanking?: number;
}

function extractNumericMetadata(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

interface DerivedParticipantSignals {
  ranking?: number;
  seed?: number;
  budgetPrice?: number;
  oddsImpliedProb?: number;
  oddsSortValue?: number;
}

function deriveParticipantSignals(
  metadata: Record<string, unknown> | undefined,
  seasonRecord: {
    rankings?: Array<{ rank?: number }>;
    budgetPrice?: number;
  } | null,
): DerivedParticipantSignals {
  const ranking =
    seasonRecord?.rankings?.[0]?.rank ??
    extractNumericMetadata(metadata, ['worldRanking', 'ranking', 'rank']);
  const seed = extractNumericMetadata(metadata, ['seed']);
  const budgetPrice = seasonRecord?.budgetPrice;

  const impliedProbability = extractImpliedProbability(metadata);
  const outrightOdds = extractNumericMetadata(metadata, [
    'morning_line_odds',
    'morningLineOdds',
    'odds',
    'outrightOdds',
  ]);

  return {
    ranking,
    seed,
    budgetPrice,
    oddsImpliedProb: impliedProbability,
    oddsSortValue: outrightOdds ?? (impliedProbability !== undefined ? 1 / impliedProbability : undefined),
  };
}

function buildEffectiveRankings(
  signals: ResolvedParticipantSignals[],
): Map<string, number> {
  const rankings = new Map<string, number>();
  const ranked = signals
    .filter((signal) => signal.ranking !== undefined && signal.ranking > 0)
    .sort((a, b) => {
      if (a.ranking !== b.ranking) {
        return (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER);
      }
      return a.participantId.localeCompare(b.participantId);
    });

  for (const signal of ranked) {
    rankings.set(signal.participantId, signal.ranking!);
  }

  let nextRank = ranked.reduce((max, signal) => Math.max(max, signal.ranking ?? 0), 0) + 1;
  const unranked = signals
    .filter((signal) => !rankings.has(signal.participantId))
    .sort((a, b) => {
      if (a.oddsImpliedProb !== undefined || b.oddsImpliedProb !== undefined) {
        if (a.oddsImpliedProb === undefined) return 1;
        if (b.oddsImpliedProb === undefined) return -1;
        if (a.oddsImpliedProb !== b.oddsImpliedProb) {
          return b.oddsImpliedProb - a.oddsImpliedProb;
        }
      }

      if (a.seed !== undefined || b.seed !== undefined) {
        if (a.seed === undefined) return 1;
        if (b.seed === undefined) return -1;
        if (a.seed !== b.seed) {
          return a.seed - b.seed;
        }
      }

      return a.participantId.localeCompare(b.participantId);
    });

  for (const signal of unranked) {
    rankings.set(signal.participantId, nextRank);
    nextRank += 1;
  }

  return rankings;
}

function extractImpliedProbability(
  metadata: Record<string, unknown> | undefined,
): number | undefined {
  const explicit = extractNumericMetadata(metadata, [
    'impliedProbability',
    'implied_probability',
    'winProbability',
    'win_probability',
    'outrightImpliedProbability',
  ]);
  if (explicit !== undefined) {
    if (explicit > 0 && explicit <= 1) return explicit;
    if (explicit > 1 && explicit <= 100) return explicit / 100;
  }

  const decimalOdds = extractNumericMetadata(metadata, [
    'morning_line_odds',
    'morningLineOdds',
    'odds',
    'outrightOdds',
  ]);
  if (decimalOdds !== undefined && decimalOdds > 0) {
    return 1 / decimalOdds;
  }

  return undefined;
}

/** Returns current season string (e.g. "2025-2026" or "2026"). */
function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // Sports seasons typically span two calendar years; use July as cutoff
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

// --- Error classes ---

export class PoolNotFoundForPricingError extends Error {
  constructor(contestId: string) {
    super(`Pool not found for contest: ${contestId}`);
    this.name = 'PoolNotFoundForPricingError';
  }
}

export class PricingLockedError extends Error {
  constructor(contestId: string) {
    super(`Cannot modify pricing — pool is locked for contest: ${contestId}`);
    this.name = 'PricingLockedError';
  }
}

export class ParticipantNotInPoolForPricingError extends Error {
  constructor(contestId: string, participantId: string) {
    super(`Participant ${participantId} not in pool for contest: ${contestId}`);
    this.name = 'ParticipantNotInPoolForPricingError';
  }
}
