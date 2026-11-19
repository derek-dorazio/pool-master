import { explicitOrder, ValuationSource } from '@poolmaster/shared/domain';
import type { SportEventOverviewDto, SportEventParticipantDto, SportEventTierDto } from '@/lib/api';

/** Who last set a row's tier or price: automatic tiering and pricing, or a root admin's correction. */
export const FieldValueSetBy = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;
export type FieldValueSetBy = (typeof FieldValueSetBy)[keyof typeof FieldValueSetBy];

/** Auto first, then the corrections. */
export const FieldValueSetByOrder = explicitOrder<FieldValueSetBy>({ [FieldValueSetBy.AUTO]: 0, [FieldValueSetBy.MANUAL]: 1 });

export const FIELD_VALUE_SET_BY_LABELS: Record<FieldValueSetBy, string> = {
  [FieldValueSetBy.AUTO]: 'Auto',
  [FieldValueSetBy.MANUAL]: 'Manual',
};

/** One row of the Event page's Field grid: the field row, with its tier, feed facts and set-by read flat. */
export type EventFieldRow = {
  entry: SportEventParticipantDto;
  id: string;
  name: string;
  teamAffiliation: string | null;
  nationality: string | null;
  seedNumber: number | null;
  ranking: number | null;
  oddsToWin: number | null;
  /** The tier's number, so the column sorts tier 1 first; null when untiered. */
  tierNumber: number | null;
  tierLabel: string | null;
  price: number | null;
  setBy: FieldValueSetBy | null;
  feedId: string | null;
  lastInFeedAt: string | null;
};

/**
 * Manual when a root admin corrected its tier or price, so that kind no longer follows automatic
 * tiering or pricing for the event; Auto when either was set automatically; null when neither is set.
 */
export function fieldValueSetBy(valuation: SportEventParticipantDto['valuation']): FieldValueSetBy | null {
  if (valuation === null) return null;
  const sources = [valuation.tierAssignedSource, valuation.priceAssignedSource];
  if (sources.includes(ValuationSource.MANUAL)) return FieldValueSetBy.MANUAL;
  return sources.some((source) => source !== null) ? FieldValueSetBy.AUTO : null;
}

/** The Field grid's rows, in the field's own order, each with its tier and its place in the feed. */
export function eventFieldRows(
  field: readonly SportEventParticipantDto[],
  tiers: readonly SportEventTierDto[],
  fieldFeed: SportEventOverviewDto['fieldFeed'],
): EventFieldRow[] {
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
  const feedByRow = new Map(fieldFeed.map((row) => [row.sportEventParticipantId, row]));
  return field.map((entry) => {
    const tierId = entry.valuation?.sportEventTierId ?? null;
    const tier = tierId === null ? undefined : tierById.get(tierId);
    const feed = feedByRow.get(entry.id);
    return {
      entry,
      id: entry.id,
      name: entry.participant.name,
      teamAffiliation: entry.participant.teamAffiliation ?? null,
      nationality: entry.participant.nationality ?? null,
      seedNumber: entry.seedNumber,
      ranking: entry.ranking,
      oddsToWin: entry.oddsToWin,
      tierNumber: tier?.tierNumber ?? null,
      tierLabel: tier?.label ?? null,
      price: entry.valuation?.price ?? null,
      setBy: fieldValueSetBy(entry.valuation),
      feedId: feed?.feedId ?? null,
      lastInFeedAt: feed?.lastInFeedAt ?? null,
    };
  });
}

/** Which optional columns the field has values for: a column nobody has a value in is left off. */
export function eventFieldColumnsShown(rows: readonly EventFieldRow[], isSynced: boolean) {
  return {
    team: rows.some((row) => row.teamAffiliation !== null),
    country: rows.some((row) => row.nationality !== null),
    seed: rows.some((row) => row.seedNumber !== null),
    lastInFeed: isSynced,
  };
}
export type EventFieldColumnsShown = ReturnType<typeof eventFieldColumnsShown>;
