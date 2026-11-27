import { z } from 'zod';
import type { SportEventDto, UpdateSportEventRequest } from '@/lib/api';

/** The details form's checks. An event's rounds are its slots' and its feed's (#2008), so the form has none. */
export const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim(),
  location: z.string().trim(),
});

export type SettingsValues = z.infer<typeof settingsSchema>;

export function valuesOf(event: SportEventDto): SettingsValues {
  return {
    name: event.name,
    venue: event.venue ?? '',
    location: event.location ?? '',
  };
}

/**
 * The details as an update, changed values only. An event's dates are its slots' (#2004), so the
 * form has none; a synced event's name and venue are its provider's (ADR 0011), so only a test
 * event's are sent.
 */
export function settingsRequestBody(
  values: SettingsValues,
  current: SettingsValues,
  { isTestData }: { isTestData: boolean },
): UpdateSportEventRequest {
  const changed = (key: keyof SettingsValues) => values[key] !== current[key];
  return {
    ...(isTestData && changed('name') && { name: values.name }),
    // A blank field clears the value (null), rather than storing an empty string.
    ...(isTestData && changed('venue') && { venue: values.venue === '' ? null : values.venue }),
    ...(changed('location') && { location: values.location === '' ? null : values.location }),
  };
}
