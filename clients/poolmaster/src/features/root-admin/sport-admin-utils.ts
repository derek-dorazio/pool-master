import { enumLabel } from '@poolmaster/shared/display-strings';
import type {
  GolfRoundScoreUploadRequest,
  ParticipantDto,
  SportEventDto,
  SportEventParticipantDto,
} from '@/lib/api';
import { type AssertTrue, type ParticipantRoundStatus } from '@poolmaster/shared/domain';

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

// --- Round scores (plans/124 §6.3) ---

export type GolfRoundScoreStatus = GolfRoundScoreUploadRequest['rows'][number]['status'];

export const GOLF_ROUND_SCORE_STATUSES = [
  'IN_PROGRESS',
  'COMPLETED',
  'DNF',
  'DSQ',
  'MISSED_CUT',
] as const satisfies readonly GolfRoundScoreStatus[];

// Compile-time exhaustiveness: adding a value to the generated `status` union
// without listing it here (or vice versa) breaks typecheck.
type _GolfRoundScoreStatusExhaustive =
  Exclude<GolfRoundScoreStatus, (typeof GOLF_ROUND_SCORE_STATUSES)[number]> extends never
    ? (typeof GOLF_ROUND_SCORE_STATUSES)[number] extends GolfRoundScoreStatus
      ? true
      : ['unknown golf round status listed', (typeof GOLF_ROUND_SCORE_STATUSES)[number]]
    : ['golf round status missing from GOLF_ROUND_SCORE_STATUSES', GolfRoundScoreStatus];
export type GolfRoundScoreStatusesMatchEnum = AssertTrue<_GolfRoundScoreStatusExhaustive>;

/** A participant's round status in words. */
export function formatGolfRoundStatus(status: GolfRoundScoreStatus): string {
  return enumLabel('ParticipantRoundStatus', status);
}

// --- One round's scores, read from the field (#236) ---
//
// The golf round-scores read is gone: each field row carries its per-round golf results,
// so the corrections grid takes the golfers with a result in the chosen round.

export type GolfRoundScoreRow = {
  sportEventParticipantId: string;
  participantName: string;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
  status: ParticipantRoundStatus;
  completedAt: string | null;
};

export function golfRoundScoreRows(
  field: readonly SportEventParticipantDto[],
  roundNumber: number,
): GolfRoundScoreRow[] {
  const rows: GolfRoundScoreRow[] = [];
  for (const entry of field) {
    const round = entry.rounds.find((candidate) => candidate.roundNumber === roundNumber);
    if (!round?.golf) {
      continue;
    }
    rows.push({
      sportEventParticipantId: entry.id,
      participantName: entry.participant.name,
      strokes: round.golf.strokes,
      scoreToPar: round.golf.scoreToPar,
      thru: round.golf.thru,
      status: round.status,
      completedAt: round.completedAt,
    });
  }
  return rows.sort((left, right) => left.participantName.localeCompare(right.participantName));
}
