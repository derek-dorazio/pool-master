import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ParticipantDto, SportEventDto } from '@/lib/api';
import { type AssertTrue } from '@poolmaster/shared/domain';

/**
 * plans/124 §6.3 / §6.4 — shared, pure helpers for the golf admin hub, tournament
 * list, create, and Tournament Home screens. All functions here are pure and
 * unit-tested in sport-admin-utils.test.ts, mirroring root-admin-sync-utils.ts.
 */

// Mirrors the `tone` variants declared on the shared StatusBadge primitive.
type BadgeTone =
  | 'active'
  | 'completed'
  | 'danger'
  | 'failed'
  | 'inactive'
  | 'info'
  | 'live'
  | 'locked'
  | 'neutral'
  | 'success'
  | 'warning';

// #236: the golf screens read the shared SportEvent and its rounds, not golf projections.
export type SportEventDtoStatus = SportEventDto['status'];

// --- Status (SportEventStatus) ---

export function formatSportEventStatus(status: SportEventDtoStatus): string {
  return enumLabel('SportEventStatus', status);
}

export function sportEventStatusTone(status: SportEventDtoStatus): BadgeTone {
  if (status === 'IN_PROGRESS') return 'live';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED' || status === 'POSTPONED') return 'warning';
  return 'neutral';
}

// --- Player status (Participant.status) ---

export type ManagedParticipantStatus = ParticipantDto['status'];

export const PARTICIPANT_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'RETIRED',
  'SUSPENDED',
] as const satisfies readonly ManagedParticipantStatus[];

// Compile-time exhaustiveness: a new value in the generated status union that is
// not listed here (or vice versa) breaks typecheck.
type _ParticipantStatusExhaustive =
  Exclude<ManagedParticipantStatus, (typeof PARTICIPANT_STATUSES)[number]> extends never
    ? (typeof PARTICIPANT_STATUSES)[number] extends ManagedParticipantStatus
      ? true
      : ['unknown golf player status listed', (typeof PARTICIPANT_STATUSES)[number]]
    : ['golf player status missing from PARTICIPANT_STATUSES', ManagedParticipantStatus];
export type ParticipantStatusesMatchEnum = AssertTrue<_ParticipantStatusExhaustive>;
