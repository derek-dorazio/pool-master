import type { FastifyBaseLogger } from 'fastify';
import type { SportEventRepository } from '@poolmaster/shared/db';
import { FieldOrderBasis, type BudgetPricingProfile, type EventPricingConfig } from '@poolmaster/shared/domain';
import type { BudgetPricingConfig } from '@poolmaster/shared/dto';
import type { SportEventTierService, SyncedFieldValuation } from './sport-event-tier-service';

/** What a field sync's run reports of the tiering and pricing that followed it. */
export interface FieldValuationReport {
  stats: Record<string, number>;
  warnings: Array<{ code: string; message: string }>;
}

export interface SyncedFieldValuationDeps {
  sportEvents: Pick<SportEventRepository, 'findByProviderRef'>;
  tiers: Pick<SportEventTierService, 'valueSyncedField'>;
  /** The Budget pricing app settings; their first profile prices an event never priced before. */
  readPricingProfiles: () => BudgetPricingConfig;
  logger?: FastifyBaseLogger;
}

/** A failed tiering or pricing, which the field sync still counts as done: the field is written. */
export type FieldValuationOutcome =
  | SyncedFieldValuation
  | { outcome: 'SKIPPED'; reason: 'NO_EVENT' }
  | { outcome: 'FAILED'; message: string };

/**
 * Tiers and prices come from the feed with no typing (#1822): after each field sync writes an
 * event's field, the field is tiered and priced while the event is a draft
 * (`SportEventTierService.valueSyncedField`), as part of the same field sync run. The auto-assign
 * buttons and the hand edits stay for corrections, and a hand edit is never overwritten.
 */
export class SyncedFieldValuationService {
  constructor(private readonly deps: SyncedFieldValuationDeps) {}

  /**
   * After a field load. The field is written either way, so a failure is logged and reported,
   * not thrown, and the next field sync tries again.
   */
  async afterFieldLoad(detail: { providerId: string; externalId: string }): Promise<FieldValuationOutcome> {
    try {
      const event = await this.deps.sportEvents.findByProviderRef(detail.providerId, detail.externalId);
      if (!event) return { outcome: 'SKIPPED', reason: 'NO_EVENT' };
      const { profiles } = this.deps.readPricingProfiles();
      return await this.deps.tiers.valueSyncedField(event, eventPricingOf(profiles[0]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger?.error(
        { providerId: detail.providerId, externalId: detail.externalId, error: message },
        'Could not tier and price a synced field',
      );
      return { outcome: 'FAILED', message };
    }
  }
}

/** A profile as an event stores the values it was priced with. */
function eventPricingOf({ name, ...values }: BudgetPricingProfile): EventPricingConfig {
  return { profileName: name, ...values };
}

/** How each order basis reads in a stat's name: "Tiers Made From Odds". */
const BASIS_WORD: Record<FieldOrderBasis, string> = {
  [FieldOrderBasis.ODDS]: 'Odds',
  [FieldOrderBasis.SEED]: 'Seed',
  [FieldOrderBasis.RANKING]: 'Rank',
  [FieldOrderBasis.NAME]: 'Name',
};

/**
 * The run's stats for one outcome, each a camel-case key the sync run screens show as words:
 * `tiersMadeFromOdds: 6` reads "Tiers Made From Odds: 6" (the tier count), `pricesMadeFromOdds: 64`
 * the participants priced. A failure is a warning on the run.
 */
export function fieldValuationReport(outcome: FieldValuationOutcome): FieldValuationReport {
  if (outcome.outcome === 'FAILED') {
    return { stats: {}, warnings: [{ code: 'TIERS_AND_PRICES_NOT_MADE', message: `Tiers and prices were not made from the field: ${outcome.message}` }] };
  }
  if (outcome.outcome === 'SKIPPED') {
    return { stats: outcome.reason === 'LOCKED' ? { tiersAndPricesLocked: 1 } : {}, warnings: [] };
  }
  const stats: Record<string, number> = {};
  const warnings: FieldValuationReport['warnings'] = [];
  const { tiers, prices } = outcome;
  if (tiers.result === 'MADE') stats[`tiersMadeFrom${BASIS_WORD[tiers.basis]}`] = tiers.tierCount;
  if (tiers.result === 'UNCHANGED') stats['tiersUnchanged'] = tiers.tierCount;
  if (tiers.result === 'KEPT_AS_EDITED') stats['tiersKeptAsEdited'] = 1;
  if (tiers.result === 'NO_TIERS') {
    warnings.push({ code: 'EVENT_HAS_NO_TIERS', message: 'The event has no tiers, so its field was not tiered.' });
  }
  if (prices.result === 'MADE') stats[`pricesMadeFrom${BASIS_WORD[prices.basis]}`] = prices.pricedCount;
  if (prices.result === 'UNCHANGED') stats['pricesUnchanged'] = prices.pricedCount;
  if (prices.result === 'KEPT_AS_EDITED') stats['pricesKeptAsEdited'] = 1;
  return { stats, warnings };
}
