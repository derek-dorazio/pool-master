import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  Sport,
  SportEventStatus,
  SportEventSyncScope,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';

/** Derived from the domain SportEventStatus constant (plans/124 §4.1) — `OFFICIAL` dropped. */
export const EventStatusDtoSchema = z.nativeEnum(SportEventStatus);
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

/**
 * Admin-only fields are annotated, not enforced (plans/145 rule 4, DOMAIN-OPERATIONS §13):
 * every caller gets the full object.
 */
const ADMIN_ONLY = '(Admin-only: operational detail no member surface reads.)';

/**
 * The canonical SportEvent — the row plus the three things every reader of an event
 * needs and the row does not store: how many participants are loaded, and whether the
 * event is ready for contest setup (derived from release/field-lock timing and the
 * loaded field). One shape for every caller; it replaced EventSummaryDto and
 * AdminEventSummaryDto, which each derived the same readiness in their own mapper.
 */
export const SportEventDtoSchema = z.object({
  id: z.string().uuid().describe('Sport-event identifier.'),
  externalId: z.string().describe(`Provider-side event identifier used by sync operations. ${ADMIN_ONLY}`),
  providerId: z.string().describe(`Provider that emitted the event, or manual-admin for an admin-authored one. ${ADMIN_ONLY}`),
  sport: z.nativeEnum(Sport).describe('Sport the event belongs to.'),
  name: z.string().describe('Event name shown in contest and event selectors.'),
  venue: z.string().nullable().describe('Venue name when known; null otherwise.'),
  location: z.string().nullable().describe('Human-readable location when known; null otherwise.'),
  status: EventStatusDtoSchema.describe('Event lifecycle status.'),
  startDate: DateTimeSchema.describe('Scheduled or actual start time.'),
  endDate: DateTimeSchema.nullable().describe('Scheduled or actual end time when known; null otherwise.'),
  rounds: z.number().int().nullable().describe('Number of rounds when the format has them; null otherwise.'),
  participantCount: z.number().int().nullable().describe('Field size the provider reports, when it reports one; null otherwise.'),
  loadedParticipantCount: z.number().int().describe('Number of event participants currently persisted for the event.'),
  releaseAt: DateTimeSchema.describe('When the event becomes available for contest setup.'),
  fieldLocksAt: DateTimeSchema.describe('After this time, field changes are no longer honored for new contest setup.'),
  fieldLocked: z.boolean().describe('Whether the field is locked for contest setup now: the provider has locked it, or fieldLocksAt has passed.'),
  readinessStatus: EventReadinessStatusDtoSchema.describe('Contest-setup readiness right now.'),
  readinessReasons: z.array(EventReadinessReasonDtoSchema).describe('Why the event is or is not contest-eligible right now.'),
  contestEligible: z.boolean().describe('Whether a contest can be created or configured for the event right now.'),
  seasonId: z.string().uuid().nullable().describe('Season the event belongs to; null for a provider-synced event with no season.'),
  leagueEventId: z.string().uuid().nullable().describe('Recurring tournament this is one year\'s instance of; null for a one-off event.'),
  syncScope: z.nativeEnum(SportEventSyncScope).describe(`How much provider data this event accepts on sync. ${ADMIN_ONLY}`),
  autoLifecycleEnabled: z.boolean().describe(`Whether the lifecycle scheduler may move this event's status. ${ADMIN_ONLY}`),
  metadata: JsonObjectSchema.describe(`Provider-emitted event metadata captured at field-load time. ${ADMIN_ONLY}`),
  createdAt: DateTimeSchema.describe('When the event row was created.'),
  updatedAt: DateTimeSchema.describe('When the event row was last updated.'),
}).describe('A real-world event a contest can be run on — a golf tournament, a race, a match.');
export type SportEventDto = z.infer<typeof SportEventDtoSchema>;

/** Filters narrow the list; nothing pages it (§16). */
export const SportEventListQuerySchema = z.object({
  sport: z.nativeEnum(Sport).optional().describe('Only events of this sport.'),
  status: EventStatusDtoSchema.optional().describe('Only events in this lifecycle status.'),
}).describe('Filters for the sport-event list.');
export type SportEventListQuery = z.infer<typeof SportEventListQuerySchema>;

export const SportEventListResponseSchema = z.object({
  events: z.array(SportEventDtoSchema).describe('Matching events, earliest start first.'),
}).describe('Sport events matching the filters.');
export type SportEventListResponse = z.infer<typeof SportEventListResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// The three enums are also consumed by admin.dto.ts; naming them gives the frontend
// importable unions instead of re-spelled literals.
registerSchema('EventStatusDto', EventStatusDtoSchema);
registerSchema('EventReadinessStatusDto', EventReadinessStatusDtoSchema);
registerSchema('EventReadinessReasonDto', EventReadinessReasonDtoSchema);
registerSchema('SportEventDto', SportEventDtoSchema);
registerSchema('SportEventListQuery', SportEventListQuerySchema);
registerSchema('SportEventListResponse', SportEventListResponseSchema);
