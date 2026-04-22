/**
 * PricingEngine — calculates budget pick prices from rankings, form, and odds.
 *
 * Pure functions that take participant data and pricing config, return prices.
 * No database access — the service layer fetches data and calls these.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { PricingConfig, PriceOverride } from '@poolmaster/shared/domain';

export interface ParticipantPricingInput {
  participantId: string;
  ranking?: number;
  formRating: number;       // 0-100
  oddsImpliedProb?: number; // 0-1 (higher = more likely to win = more expensive)
  seed?: number;            // tournament seed (lower = better = more expensive)
}

export interface ParticipantPrice {
  participantId: string;
  price: number;
  isOverride: boolean;
  overrideReason?: string;
}

/**
 * Calculates prices for all participants in a pool based on the pricing config.
 *
 * Algorithm:
 * 1. Compute a raw score for each participant from ranking, form, and odds
 * 2. Normalise raw scores to [0, 1] range
 * 3. Map to price range [minPrice, maxPrice] via linear interpolation
 * 4. Round to priceIncrement
 * 5. Apply manual overrides
 */
export function calculatePrices(
  participants: ParticipantPricingInput[],
  config: PricingConfig,
  logger?: FastifyBaseLogger,
): ParticipantPrice[] {
  logger?.debug({
    action: 'participantPricing.calculate.start',
    data: {
      participantCount: participants.length,
      overrideCount: config.manualOverrides.length,
    },
  }, 'Calculating participant prices');
  if (participants.length === 0) {
    logger?.info({
      action: 'participantPricing.calculate.empty',
      data: {
        participantCount: 0,
      },
    }, 'No participants available for pricing');
    return [];
  }

  const overrideMap = buildOverrideMap(config.manualOverrides);

  // Step 1: Compute raw scores
  const scored = participants.map((p) => ({
    participantId: p.participantId,
    rawScore: computeRawScore(p, config, participants.length),
  }));

  // Step 2: Normalise to [0, 1]
  const scores = scored.map((s) => s.rawScore);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = maxScore - minScore || 1; // avoid div by zero

  // Step 3-4: Map to price range and round
  const prices = scored.map((s) => {
    const override = overrideMap.get(s.participantId);
    if (override) {
      logger?.debug({
        action: 'participantPricing.calculate.override',
        data: {
          participantId: s.participantId,
          overridePrice: override.overridePrice,
        },
      }, 'Applied manual price override');
      return {
        participantId: s.participantId,
        price: override.overridePrice,
        isOverride: true,
        overrideReason: override.reason,
      };
    }

    const normalised = (s.rawScore - minScore) / scoreRange;
    const rawPrice = config.minPrice + normalised * (config.maxPrice - config.minPrice);
    const price = roundToIncrement(rawPrice, config.priceIncrement);
    const clampedPrice = Math.max(config.minPrice, Math.min(config.maxPrice, price));

    return {
      participantId: s.participantId,
      price: clampedPrice,
      isOverride: false,
    };
  });
  logger?.info({
    action: 'participantPricing.calculate.success',
    data: {
      participantCount: prices.length,
      overrideCount: prices.filter((price) => price.isOverride).length,
    },
  }, 'Calculated participant prices');
  return prices;
}

/**
 * Computes a raw score for a participant. Higher = more expensive.
 * Each component is normalised to roughly [0, 1] before weighting.
 */
function computeRawScore(
  participant: ParticipantPricingInput,
  config: PricingConfig,
  totalParticipants: number,
): number {
  let score = 0;

  // Ranking component: rank 1 = best = highest score
  if (config.rankingWeight > 0 && participant.ranking !== undefined) {
    // Invert ranking so rank 1 → 1.0, rank N → 0.0
    const normalisedRank = 1 - (participant.ranking - 1) / Math.max(totalParticipants - 1, 1);
    score += config.rankingWeight * normalisedRank;
  }

  // Form component: formRating is already 0-100, normalise to 0-1
  if (config.formWeight > 0) {
    score += config.formWeight * (participant.formRating / 100);
  }

  // Odds component: implied probability 0-1 (higher = more likely to win)
  if (config.oddsWeight > 0 && participant.oddsImpliedProb !== undefined) {
    score += config.oddsWeight * participant.oddsImpliedProb;
  }

  // Seed component: seed 1 = best = highest score (used for NCAA, tennis draws)
  if (config.seedWeight > 0 && participant.seed !== undefined) {
    const normalisedSeed = 1 - (participant.seed - 1) / Math.max(totalParticipants - 1, 1);
    score += config.seedWeight * normalisedSeed;
  }

  return score;
}

function roundToIncrement(value: number, increment: number): number {
  if (increment <= 0) return Math.round(value);
  return Math.round(value / increment) * increment;
}

function buildOverrideMap(overrides: PriceOverride[]): Map<string, PriceOverride> {
  const map = new Map<string, PriceOverride>();
  for (const o of overrides) {
    map.set(o.participantId, o);
  }
  return map;
}
