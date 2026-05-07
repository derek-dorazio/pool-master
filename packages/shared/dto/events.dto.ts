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

/**
 * Canonical Sport DTO — pure projection of the `sports` row per plans/117
 * §4.1 / §12.1. Drives per-category scoring dispatch and the validity
 * matrix in plans/117 §9.
 *
 * `category` / `tournamentFormat` use `z.nativeEnum(...)` instead of
 * `z.enum(Object.values(...))` so the union stays compile-time exhaustive:
 * adding a new SportCategory or TournamentFormat value forces every
 * consumer that switches on the enum to be updated rather than silently
 * accepting the new variant.
 */
export const SportDtoSchema = z.object({
  id: z.string().describe('Sport identifier.'),
  name: z.string().describe('Sport name. Currently legacy enum-style (Sport.GOLF, Sport.NFL); granular tournament names land in a later slice.'),
  participantType: z.nativeEnum(ParticipantType).describe('Whether the sport is individual- or team-based.'),
  category: z.nativeEnum(SportCategory).describe('Sport category, drives per-category scoring detail-table dispatch (plans/117 §6).'),
  tournamentFormat: z.nativeEnum(TournamentFormat).describe('Tournament format, drives the validity matrix in plans/117 §9.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical Sport DTO per plans/117 §4.1 / §12.1 — pure row projection.');
export type SportDto = z.infer<typeof SportDtoSchema>;

/**
 * Canonical SportEvent DTO — pure row projection per plans/117 §4.1 / §12.1.
 *
 * Distinct from the legacy `EventSummaryDto`, which adds derived
 * operational fields (`readinessStatus`, `readinessReasons`,
 * `contestEligible`) computed at the route boundary. SportEventDto is the
 * persistence-aware shape; routes that need operational derivations
 * compose them on top.
 */
export const SportEventDtoSchema = z.object({
  id: z.string().describe('Sport-event identifier.'),
  externalId: z.string().describe('Provider-side event identifier.'),
  providerId: z.string().describe('Provider that emitted this event.'),
  sport: z.nativeEnum(Sport).describe('Sport associated with the event.'),
  name: z.string().describe('Primary event name.'),
  venue: z.string().nullable().describe('Venue name when known; null otherwise.'),
  location: z.string().nullable().describe('Human-readable event location when known; null otherwise.'),
  startDate: DateTimeSchema.describe('Scheduled or actual event start time.'),
  endDate: DateTimeSchema.nullable().describe('Scheduled or actual event end time when known; null otherwise.'),
  status: EventStatusDtoSchema.describe('Provider-normalized event status.'),
  rounds: z.number().int().nullable().describe('Tournament round count when applicable; null otherwise.'),
  participantCount: z.number().int().nullable().describe('Provider-reported field size when known; null otherwise.'),
  releaseAt: DateTimeSchema.describe('PoolMaster operational datetime when the event becomes available for contest setup.'),
  fieldLocksAt: DateTimeSchema.describe('PoolMaster operational datetime after which event-field changes are no longer honored.'),
  fieldLocked: z.boolean().describe('Whether the event field is currently locked for contest setup (raw column).'),
  metadata: JsonObjectSchema.describe('Provider-emitted event metadata captured at field-load time.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical SportEvent DTO per plans/117 §4.1 / §12.1 — pure row projection.');
export type SportEventDto = z.infer<typeof SportEventDtoSchema>;

/**
 * Canonical SportEventParticipant DTO — pure row projection per
 * plans/117 §4.1 / §12.1. The per-event ranking fields (`worldRanking`,
 * `oddsToWin`, `seedNumber`) landed in pool-master-rop.78.4 and replace
 * the dropped ParticipantSeasonRecord path.
 *
 * All optional row columns are `.nullable()` (not `.optional()`) so the
 * DTO mirrors the row shape exactly: every key is present, with null when
 * the column has no value. This eliminates the `T | null | undefined`
 * trichotomy at consumers.
 */
export const SportEventParticipantDtoSchema = z.object({
  id: z.string().describe('Sport-event-participant identifier.'),
  sportEventId: z.string().describe('Owning sport-event identifier.'),
  participantId: z.string().describe('Canonical participant identifier (the across-events Participant row).'),
  status: z.string().nullable().describe('Provider-emitted per-event participant status (ACTIVE, WITHDRAWN, etc.); null when unknown.'),
  worldRanking: z.number().int().nullable().describe('Per-event world ranking snapshot from the provider feed at field-load time; null when not provided.'),
  oddsToWin: z.number().nullable().describe('Per-event implied odds-to-win snapshot (decimal); null when not provided.'),
  seedNumber: z.number().int().nullable().describe('Event-relative seed number (e.g., NCAA tournament seed); null when not provided.'),
  metadata: JsonObjectSchema.describe('Provider-emitted per-participant metadata.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical SportEventParticipant DTO per plans/117 §4.1 / §12.1 — pure row projection.');
export type SportEventParticipantDto = z.infer<typeof SportEventParticipantDtoSchema>;
