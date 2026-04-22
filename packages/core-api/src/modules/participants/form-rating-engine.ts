/**
 * FormRatingEngine — calculates a participant's form rating (0-100)
 * from their recent event results.
 *
 * Form rating is a rolling composite score that reflects recent performance.
 * Higher = better recent form.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { FormTrend } from '@poolmaster/shared/domain';

export interface EventResult {
  eventId: string;
  finishPosition: number;
  fieldSize: number;
  eventDate: Date;
  weight?: number; // optional manual weight for major events
}

export interface FormRatingResult {
  formRating: number;    // 0-100
  formTrend: FormTrend;  // RISING, STABLE, FALLING
  eventsConsidered: number;
}

/** Number of recent events to consider for form calculation. */
const FORM_WINDOW = 10;

/** Decay factor — more recent events are weighted more heavily. */
const RECENCY_DECAY = 0.85;

/** Threshold for trend detection — minimum delta between halves. */
const TREND_THRESHOLD = 5;

/**
 * Calculates form rating from a list of recent event results.
 *
 * Algorithm:
 * 1. Take the most recent N events (sorted by date desc)
 * 2. For each event, compute a percentile finish (0-100) based on field size
 * 3. Apply recency weighting (most recent event = highest weight)
 * 4. Compute weighted average
 * 5. Determine trend by comparing first half vs second half of window
 */
export function calculateFormRating(results: EventResult[], logger?: FastifyBaseLogger): FormRatingResult {
  logger?.debug({
    action: 'participantForm.calculate.start',
    data: {
      resultCount: results.length,
    },
  }, 'Calculating participant form rating');
  if (results.length === 0) {
    logger?.info({
      action: 'participantForm.calculate.empty',
      data: {
        resultCount: 0,
      },
    }, 'No results available for form rating');
    return { formRating: 50, formTrend: 'STABLE', eventsConsidered: 0 };
  }

  // Sort by date descending (most recent first)
  const sorted = [...results]
    .sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime())
    .slice(0, FORM_WINDOW);

  // Calculate percentile finish for each event
  const percentiles = sorted.map((r) => {
    // Position 1 of 156 → percentile ~99.4; position 156 of 156 → percentile ~0
    const percentile = ((r.fieldSize - r.finishPosition) / Math.max(r.fieldSize - 1, 1)) * 100;
    return {
      percentile: Math.max(0, Math.min(100, percentile)),
      weight: r.weight ?? 1,
    };
  });

  // Apply recency weighting
  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < percentiles.length; i++) {
    const recencyWeight = Math.pow(RECENCY_DECAY, i);
    const eventWeight = percentiles[i].weight * recencyWeight;
    weightedSum += percentiles[i].percentile * eventWeight;
    totalWeight += eventWeight;
  }

  const formRating = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;

  // Determine trend: compare first half (recent) vs second half (older)
  const formTrend = calculateTrend(percentiles.map((p) => p.percentile));

  const result = {
    formRating: Math.max(0, Math.min(100, formRating)),
    formTrend,
    eventsConsidered: sorted.length,
  };
  logger?.info({
    action: 'participantForm.calculate.success',
    data: {
      resultCount: results.length,
      formRating: result.formRating,
      formTrend: result.formTrend,
      eventsConsidered: result.eventsConsidered,
    },
  }, 'Calculated participant form rating');
  return result;
}

function calculateTrend(percentiles: number[]): FormTrend {
  if (percentiles.length < 4) return 'STABLE';

  const mid = Math.floor(percentiles.length / 2);
  const recentHalf = percentiles.slice(0, mid);
  const olderHalf = percentiles.slice(mid);

  const recentAvg = average(recentHalf);
  const olderAvg = average(olderHalf);
  const delta = recentAvg - olderAvg;

  if (delta > TREND_THRESHOLD) return 'RISING';
  if (delta < -TREND_THRESHOLD) return 'FALLING';
  return 'STABLE';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
