import { z } from 'zod';
import { Sport } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';

export const EventStatusDtoSchema = z.enum([
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'POSTPONED',
]);
export type EventStatusDto = z.infer<typeof EventStatusDtoSchema>;

export const EventReadinessStatusDtoSchema = z.enum([
  'NOT_RELEASED',
  'PENDING_FIELD',
  'CONTEST_ELIGIBLE',
  'FIELD_LOCKED',
]);
export type EventReadinessStatusDto = z.infer<typeof EventReadinessStatusDtoSchema>;

export const EventReadinessReasonDtoSchema = z.enum([
  'EVENT_NOT_RELEASED',
  'FIELD_NOT_LOADED',
  'FIELD_LOCKED',
]);
export type EventReadinessReasonDto = z.infer<typeof EventReadinessReasonDtoSchema>;

export const EventListQuerySchema = z.object({
  sport: z.string().optional().describe('Optional sport filter.'),
  status: z.string().optional().describe('Optional provider-normalized event status filter.'),
  limit: z.number().int().min(1).max(100).optional().describe('Optional page-size style limit.'),
});
export type EventListQuery = z.infer<typeof EventListQuerySchema>;

export const EventSummaryDtoSchema = z.object({
  id: z.string().describe('Sport-event identifier.'),
  sport: z.enum([
    Sport.GOLF,
    Sport.NFL,
    Sport.NBA,
    Sport.F1,
    Sport.NASCAR,
    Sport.NCAA_BASKETBALL,
    Sport.NCAA_HOCKEY,
    Sport.NCAA_FOOTBALL,
    Sport.TENNIS,
    Sport.HORSE_RACING,
    Sport.SOCCER,
    Sport.NHL,
    Sport.MLB,
    Sport.UFC,
  ]).describe('Sport associated with the event.'),
  name: z.string().describe('Primary event name shown in contest and event selectors.'),
  venue: z.string().nullable().optional().describe('Venue name for the event, when known.'),
  location: z.string().nullable().optional().describe('Human-readable event location, when known.'),
  status: EventStatusDtoSchema.describe('Provider-normalized event status.'),
  startDate: DateTimeSchema.describe('Scheduled or actual event start time.'),
  endDate: DateTimeSchema.nullable().optional().describe('Scheduled or actual event end time, when known.'),
  releaseAt: DateTimeSchema.describe('PoolMaster operational datetime when the event becomes available for contest setup.'),
  fieldLocksAt: DateTimeSchema.describe('PoolMaster operational datetime after which event-field changes are no longer honored for new contest setup.'),
  participantCount: z.number().int().nullable().optional().describe('Participant count when the provider exposes field size.'),
  fieldLocked: z.boolean().describe('Compatibility projection that reflects whether the event field should currently be treated as locked for contest setup behavior.'),
  readinessStatus: EventReadinessStatusDtoSchema.describe('Current readiness state for contest setup and event-driven contest operations.'),
  readinessReasons: z.array(EventReadinessReasonDtoSchema).describe('Structured reasons explaining why the event is or is not contest-eligible right now.'),
  contestEligible: z.boolean().describe('Whether the event is currently eligible for contest creation/configuration flows.'),
}).describe('Event list item returned from event-discovery endpoints.');
export type EventSummaryDto = z.infer<typeof EventSummaryDtoSchema>;

export const EventListResponseSchema = z.object({
  events: z.array(EventSummaryDtoSchema),
}).describe('Event list response for the requested sport or filter set.');
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
