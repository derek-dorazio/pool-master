import type { SportEventParticipantDto, UpdateSportEventParticipantsRequest } from '@/lib/api';

// #236: a field row is the shared SportEventParticipant; its price sits on the valuation.
export type EventFieldEntry = SportEventParticipantDto;
export type EventFieldInactiveReason = NonNullable<EventFieldEntry['inactiveReason']>;
export type EventFieldPatch = UpdateSportEventParticipantsRequest['participants'][number];

export type EventFieldNumericKey = 'ranking' | 'oddsToWin' | 'seedNumber' | 'price';

export const EVENT_FIELD_INACTIVE_REASONS: readonly EventFieldInactiveReason[] = [
  'WITHDRAWN',
  'ELIMINATED',
];

/** Rank and seed are stored as 32-bit integers, so the server refuses anything larger. */
const MAX_INT32 = 2147483647;

function isPositiveInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0 && Number(raw) <= MAX_INT32;
}

function isNonNegativeInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

function isPositiveNumber(raw: string): boolean {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(value) && value > 0;
}

/** Whether a typed value can be stored in that column. Blank is checked by the caller: it clears. */
export const EVENT_FIELD_NUMERIC_VALIDATORS: Record<EventFieldNumericKey, (raw: string) => boolean> = {
  ranking: isPositiveInt,
  seedNumber: isPositiveInt,
  price: isNonNegativeInt,
  oddsToWin: isPositiveNumber,
};

/** The stored value of one numeric column; price is the valuation's. */
export function eventFieldServerValue(entry: EventFieldEntry, key: EventFieldNumericKey): number | null {
  return key === 'price' ? entry.valuation?.price ?? null : entry[key];
}
