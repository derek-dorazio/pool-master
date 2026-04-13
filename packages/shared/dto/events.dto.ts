import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

export const EventSummaryDtoSchema = z.object({
  id: z.string().describe('Sport-event identifier.'),
  sport: z.string().describe('Sport associated with the event.'),
  name: z.string().describe('Primary event name shown in contest and event selectors.'),
  venue: z.string().nullable().optional().describe('Venue name for the event, when known.'),
  location: z.string().nullable().optional().describe('Human-readable event location, when known.'),
  status: z.string().describe('Provider-normalized event status.'),
  startDate: DateTimeSchema.describe('Scheduled or actual event start time.'),
  endDate: DateTimeSchema.nullable().optional().describe('Scheduled or actual event end time, when known.'),
  participantCount: z.number().int().nullable().optional().describe('Participant count when the provider exposes field size.'),
  fieldLocked: z.boolean().describe('Whether contest participant pools should be treated as locked for the event.'),
}).describe('Event list item returned from event-discovery endpoints.');
export type EventSummaryDto = z.infer<typeof EventSummaryDtoSchema>;

export const EventListResponseSchema = z.object({
  events: z.array(EventSummaryDtoSchema),
}).describe('Event list response for the requested sport or filter set.');
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
