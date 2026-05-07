import { z } from 'zod';
import {
  ParticipantType,
  Sport,
  SportCategory,
  TournamentFormat,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

export const EventStatusDtoSchema = z.enum([
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'OFFICIAL',
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
  externalId: z.string().describe('Provider event identifier used by event-level sync operations.'),
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

// ============================================================================
// pool-master-rop.78.5 — canonical entity DTOs per plans/117 §12.1
// ============================================================================

const sportCategoryValues = Object.values(SportCategory) as [string, ...string[]];
const tournamentFormatValues = Object.values(TournamentFormat) as [string, ...string[]];

/**
 * Canonical Sport DTO. The `category` and `tournamentFormat` columns landed
 * in pool-master-rop.78.4 (plans/117 §4.1). Drives per-category scoring
 * dispatch and the validity matrix in plans/117 §9.
 */
export const SportDtoSchema = z.object({
  id: z.string().describe('Sport identifier.'),
  name: z.string().describe('Sport name (legacy enum-style — Sport.GOLF, Sport.NFL — until granular tournament names land in a future slice).'),
  participantType: z.enum([ParticipantType.INDIVIDUAL, ParticipantType.TEAM]).describe('Whether the sport is individual- or team-based.'),
  category: z.enum(sportCategoryValues).describe('Sport category, drives per-category scoring detail-table dispatch (plans/117 §6).'),
  tournamentFormat: z.enum(tournamentFormatValues).describe('Tournament format, drives the validity matrix in plans/117 §9.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical Sport DTO returned by sport-list and contest-creation endpoints.');
export type SportDto = z.infer<typeof SportDtoSchema>;

/**
 * Canonical SportEvent DTO. The slice's §12.1 name aligns with the design
 * plan; functionally equivalent to the existing EventSummaryDto but with
 * the additional metadata field that surfaces provider-emitted JSON.
 *
 * EventSummaryDto stays exported for back-compat with surfaces that don't
 * need metadata; new consumers should prefer SportEventDto.
 */
export const SportEventDtoSchema = EventSummaryDtoSchema.extend({
  metadata: JsonObjectSchema.describe('Provider-emitted event metadata captured at field-load time.'),
}).describe('Canonical SportEvent DTO per plans/117 §12.1.');
export type SportEventDto = z.infer<typeof SportEventDtoSchema>;

/**
 * Canonical SportEventParticipant DTO. The per-event ranking fields
 * (`worldRanking`, `oddsToWin`, `seedNumber`) landed in pool-master-rop.78.4
 * and replace the dropped ParticipantSeasonRecord path — per plans/117 §4.1,
 * world ranking and odds are per-event snapshots from the provider feed.
 */
export const SportEventParticipantDtoSchema = z.object({
  id: z.string().describe('Sport-event-participant identifier.'),
  sportEventId: z.string().describe('Owning sport-event identifier.'),
  participantId: z.string().describe('Canonical participant identifier (the across-events Participant row).'),
  status: z.string().nullable().optional().describe('Provider-emitted per-event participant status (ACTIVE, WITHDRAWN, etc.).'),
  worldRanking: z.number().int().nullable().optional().describe('Per-event world ranking snapshot from the provider feed at field-load time.'),
  oddsToWin: z.number().nullable().optional().describe('Per-event implied odds-to-win snapshot (decimal).'),
  seedNumber: z.number().int().nullable().optional().describe('Event-relative seed number (e.g., NCAA tournament seed).'),
  metadata: JsonObjectSchema.describe('Provider-emitted per-participant metadata.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical SportEventParticipant DTO returned by pre-event participant browse and entry-detail surfaces.');
export type SportEventParticipantDto = z.infer<typeof SportEventParticipantDtoSchema>;
