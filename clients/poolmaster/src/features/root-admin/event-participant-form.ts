import { z } from 'zod';
import type { SportEventTierDto } from '@/lib/api';
import {
  EVENT_FIELD_NUMERIC_VALIDATORS,
  eventFieldServerValue,
  type EventFieldEntry,
  type EventFieldNumericKey,
  type EventFieldPatch,
} from './event-field-patch';

const NUMERIC_MESSAGES: Record<EventFieldNumericKey, string> = {
  ranking: 'Rank is a whole number from 1, or blank',
  seedNumber: 'Seed is a whole number from 1, or blank',
  price: 'Price is a whole number from 0, or blank',
};

function numeric(key: EventFieldNumericKey) {
  return z.string().trim().refine((raw) => raw === '' || EVENT_FIELD_NUMERIC_VALIDATORS[key](raw), NUMERIC_MESSAGES[key]);
}

/** The field participant dialog's Edit form: every value as typed, blank for none. */
export const participantSchema = z.object({
  /** The tier's key; blank while untiered. */
  tierKey: z.string(),
  price: numeric('price'),
  ranking: numeric('ranking'),
  seedNumber: numeric('seedNumber'),
});
export type ParticipantValues = z.infer<typeof participantSchema>;

function typed(value: number | null): string {
  return value === null ? '' : String(value);
}

export function participantValuesOf(entry: EventFieldEntry, tiers: readonly SportEventTierDto[]): ParticipantValues {
  const tierId = entry.valuation?.sportEventTierId ?? null;
  const tier = tierId === null ? undefined : tiers.find((candidate) => candidate.id === tierId);
  return {
    tierKey: tier?.tierKey ?? '',
    price: typed(eventFieldServerValue(entry, 'price')),
    ranking: typed(entry.ranking),
    seedNumber: typed(entry.seedNumber),
  };
}

/** What the dialog may correct: tier and price until release; rank and seed only where no feed sets them. */
export type ParticipantEditable = { tierAndPrice: boolean; orderValues: boolean };

/**
 * The one patch a Save sends, or null when nothing changed: each value only when it changed
 * (blank clears), and the move into another tier, which the server places last in it, all in
 * one write. A tier can't be cleared here: blank means the participant stays untiered.
 */
export function participantCorrection(
  values: ParticipantValues,
  current: ParticipantValues,
  entry: EventFieldEntry,
  editable: ParticipantEditable,
): EventFieldPatch | null {
  const keys: EventFieldNumericKey[] = [
    ...(editable.tierAndPrice ? ['price' as const] : []),
    ...(editable.orderValues ? (['ranking', 'seedNumber'] as const) : []),
  ];
  const changes: Partial<Record<EventFieldNumericKey, number | null>> = {};
  for (const key of keys) {
    if (values[key] !== current[key]) {
      changes[key] = values[key] === '' ? null : Number(values[key]);
    }
  }
  const tierKey = editable.tierAndPrice && values.tierKey !== '' && values.tierKey !== current.tierKey ? values.tierKey : undefined;
  if (Object.keys(changes).length === 0 && tierKey === undefined) return null;
  return { sportEventParticipantId: entry.id, ...changes, ...(tierKey !== undefined && { tierKey }) };
}
