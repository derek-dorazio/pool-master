import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const EventSummaryDtoSchema = z.object({
  id: z.string(),
  sport: z.string(),
  name: z.string(),
  venue: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.string(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.nullable().optional(),
  participantCount: z.number().int().nullable().optional(),
  fieldLocked: z.boolean(),
});
export type EventSummaryDto = z.infer<typeof EventSummaryDtoSchema>;

export const EventListResponseSchema = z.object({
  events: z.array(EventSummaryDtoSchema),
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
