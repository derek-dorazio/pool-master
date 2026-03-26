/**
 * PricingAndTierService — orchestrates pricing calculation and tier assignment
 * for contest participant pools.
 */

import type {
  ContestPoolRepository,
  ContestParticipantPoolRepository,
  ParticipantSeasonRecordRepository,
} from '@poolmaster/shared/db';
import type {
  ContestPool,
  PricingConfig,
  PriceOverride,
  TierConfig,
  TierDefinition,
} from '@poolmaster/shared/domain';
import type { Sport, TierAssignmentMode } from '@poolmaster/shared/domain';
import { calculatePrices, type ParticipantPricingInput } from './pricing-engine';
import { assignTiers, type TierableParticipant } from './tier-engine';

// --- Default pricing config ---

const DEFAULT_PRICING_CONFIG: Omit<PricingConfig, 'sport'> = {
  totalBudget: 50000,
  minPrice: 3000,
  maxPrice: 15000,
  priceIncrement: 100,
  rankingWeight: 0.5,
  formWeight: 0.3,
  oddsWeight: 0.2,
  manualOverrides: [],
};

// --- Service ---

export class PricingAndTierService {
  constructor(
    private readonly poolRepo: ContestPoolRepository,
    private readonly poolParticipantRepo: ContestParticipantPoolRepository,
    private readonly seasonRecordRepo: ParticipantSeasonRecordRepository,
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

    // Fetch season records for all participants to get ranking + form
    const season = getCurrentSeason();
    const inputs: ParticipantPricingInput[] = [];

    for (const pp of poolParticipants) {
      const seasonRecord = await this.seasonRecordRepo.findByParticipantAndSeason(
        pp.participantId,
        season,
      );
      inputs.push({
        participantId: pp.participantId,
        ranking: pp.ranking ?? seasonRecord?.rankings?.[0]?.rank,
        formRating: seasonRecord ? Number(seasonRecord.formRating) : 50,
        // oddsImpliedProb: undefined — odds integration is deferred to Plan 06
      });
    }

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
    reason: string,
    setBy: string,
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

    const tierableParticipants: TierableParticipant[] = poolParticipants.map((pp) => ({
      participantId: pp.participantId,
      ranking: pp.ranking,
      price: pp.cost,
    }));

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
