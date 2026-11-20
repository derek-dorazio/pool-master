import { z } from 'zod';
import type { SportEventRoundDto, UpdateSportEventRoundsRequest } from '@/lib/api';
import { dateTimeLocalValueToIso, toDateTimeLocalValue } from '@/features/shared/ui';

/** The round dialog's Edit form: its start and end, as typed in the viewer's time zone. */
export const roundScheduleSchema = z.object({
  scheduledDate: z.string().min(1, 'A start is required'),
  /** Blank clears the end. */
  scheduledEndAt: z.string(),
});
export type RoundScheduleValues = z.infer<typeof roundScheduleSchema>;

export function roundScheduleValuesOf(round: SportEventRoundDto, timeZone: string): RoundScheduleValues {
  return {
    scheduledDate: toDateTimeLocalValue(round.scheduledDate, timeZone),
    scheduledEndAt: toDateTimeLocalValue(round.scheduledEndAt, timeZone),
  };
}

/** The one round's reschedule, as the rounds save takes it: a blank end is cleared, not kept. */
export function roundScheduleRequestBody(round: SportEventRoundDto, values: RoundScheduleValues, timeZone: string): UpdateSportEventRoundsRequest {
  return {
    rounds: [{
      roundNumber: round.roundNumber,
      scheduledDate: dateTimeLocalValueToIso(values.scheduledDate, timeZone) ?? values.scheduledDate,
      scheduledEndAt: dateTimeLocalValueToIso(values.scheduledEndAt, timeZone) ?? null,
    }],
  };
}
