import { ValuationSource } from '@poolmaster/shared/domain';
import { z } from 'zod';
import type { ReplaceSportEventTiersRequest, SportEventTierDto } from '@/lib/api';
import type { EventFieldEntry } from './event-field-patch';

/** The ⚙ Tiers dialog's form: the event's tiers in order, each named by its place (#2047), and where a removed tier's participants go. */
export const eventTiersSchema = z.object({
  tiers: z.array(z.object({
    /** Kept for a tier the event has, so its participants stay in it; a new one gets a fresh key. */
    tierKey: z.string(),
  })).min(1, 'Keep at least one tier'),
  /** A tier key from `tiers`; asked only once a tier was placed by hand and a removed tier has participants. */
  reassignTo: z.string(),
});
export type EventTiersValues = z.infer<typeof eventTiersSchema>;

export function eventTiersValuesOf(tiers: readonly SportEventTierDto[]): EventTiersValues {
  return {
    tiers: [...tiers].sort((left, right) => left.tierNumber - right.tierNumber).map(({ tierKey }) => ({ tierKey })),
    reassignTo: '',
  };
}

/**
 * A key no tier has, in the list or among the event's saved tiers, so a new tier never takes over
 * a removed tier's participants.
 */
export function nextTierKey(keys: readonly string[]): string {
  const taken = new Set(keys);
  let number = taken.size + 1;
  while (taken.has(`TIER_${String(number)}`)) number += 1;
  return `TIER_${String(number)}`;
}

/**
 * How many participants would be left in a removed tier, which only matters once a tier was
 * placed by hand: until then a save places the whole field in the new tiers afresh.
 */
export function strandedCount(values: EventTiersValues, tiers: readonly SportEventTierDto[], field: readonly EventFieldEntry[]): number {
  if (!field.some((entry) => entry.valuation?.tierAssignedSource === ValuationSource.MANUAL)) return 0;
  const kept = new Set(values.tiers.map((tier) => tier.tierKey));
  const removedIds = new Set(tiers.filter((tier) => !kept.has(tier.tierKey)).map((tier) => tier.id));
  return field.filter((entry) => entry.valuation?.sportEventTierId != null && removedIds.has(entry.valuation.sportEventTierId)).length;
}

export function eventTiersRequestBody(values: EventTiersValues, stranded: number): ReplaceSportEventTiersRequest {
  return {
    tiers: values.tiers.map((tier, index) => ({ tierKey: tier.tierKey, tierNumber: index + 1 })),
    ...(stranded > 0 && values.reassignTo !== '' ? { reassignOrphansTo: values.reassignTo } : {}),
  };
}
