import { FieldOrderBasis } from '@poolmaster/shared/domain';
import { ROUNDS_PAR_MAX, ROUNDS_PAR_MIN } from '@poolmaster/shared/dto';
import { z } from 'zod';
import type { SportEventDto, UpdateSportEventRequest } from '@/lib/api';
import { dateTimeLocalValueToIso, toDateTimeLocalValue } from '@/features/shared/ui';

export const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim(),
  location: z.string().trim(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string(),
  rounds: z.string().refine((value) => /^\d+$/.test(value) && Number(value) >= 1, 'At least one round'),
  // Blank means "not set": contest scoring then derives each round's par from the field.
  roundsPar: z.string().trim().refine((value) => {
    if (value === '') return true;
    const par = Number(value);
    return Number.isInteger(par) && par >= ROUNDS_PAR_MIN && par <= ROUNDS_PAR_MAX;
  }, `Par is a whole number from ${String(ROUNDS_PAR_MIN)} to ${String(ROUNDS_PAR_MAX)}, or blank`),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

/** Each value the field can be ordered by, as the ⚙ dialog names it. */
export const TIER_ORDER_LABELS: Record<FieldOrderBasis, string> = {
  [FieldOrderBasis.ODDS]: 'Odds',
  [FieldOrderBasis.SEED]: 'Seed',
  [FieldOrderBasis.RANKING]: 'Rank',
};

export function valuesOf(event: SportEventDto, timeZone: string): SettingsValues {
  return {
    name: event.name,
    venue: event.venue ?? '',
    location: event.location ?? '',
    startDate: toDateTimeLocalValue(event.startDate, timeZone),
    endDate: toDateTimeLocalValue(event.endDate, timeZone),
    rounds: String(event.rounds ?? 1),
    roundsPar: event.roundsPar === null ? '' : String(event.roundsPar),
  };
}

/**
 * The details as an update, changed values only. A provider-synced event's name, venue and dates
 * are its provider's (ADR 0011), so the form leaves them out and they are never sent; par per round
 * is sent only for a family that reads it.
 */
export function settingsRequestBody(
  values: SettingsValues,
  current: SettingsValues,
  { providerSynced, sendsRoundsPar, timeZone }: { providerSynced: boolean; sendsRoundsPar: boolean; timeZone: string },
): UpdateSportEventRequest {
  const changed = (key: keyof SettingsValues) => values[key] !== current[key];
  return {
    ...(!providerSynced && changed('name') && { name: values.name }),
    // A blank field clears the value (null), rather than storing an empty string.
    ...(!providerSynced && changed('venue') && { venue: values.venue === '' ? null : values.venue }),
    ...(!providerSynced && changed('startDate') && { startDate: dateTimeLocalValueToIso(values.startDate, timeZone) ?? values.startDate }),
    ...(!providerSynced && changed('endDate') && { endDate: dateTimeLocalValueToIso(values.endDate, timeZone) ?? null }),
    ...(changed('location') && { location: values.location === '' ? null : values.location }),
    ...(changed('rounds') && { rounds: Number(values.rounds) }),
    ...(sendsRoundsPar && changed('roundsPar') && { roundsPar: values.roundsPar === '' ? null : Number(values.roundsPar) }),
  };
}
