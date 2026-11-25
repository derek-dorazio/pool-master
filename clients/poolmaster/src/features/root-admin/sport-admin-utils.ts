import { enumLabel } from '@poolmaster/shared/display-strings';
import { z } from 'zod';
import {
  parseDelimitedRecords,
  type BulkUploadFormat,
} from '@/features/shared/ui/bulk-upload-parse';
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

// --- Round-score bulk upload (plans/124 §6.3 Round scores / §6.4) ---
//
// plans/124 §6.3 documents the CSV header as `externalId,playerName,strokes,thru,status`,
// but the generated `applyEventGolfRoundScores` request row also requires `scoreToPar`
// (not optional) and `status` is a fixed 5-value enum. The template + parser therefore
// carry `scoreToPar` too; the discrepancy is flagged in the pool-master-r11 close note.

export type GolfRoundScoreUploadRow = GolfRoundScoreUploadRequest['rows'][number];
export type GolfRoundScoreStatus = GolfRoundScoreUploadRow['status'];

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

export const GOLF_ROUND_SCORE_UPLOAD_HEADERS = [
  'participantId',
  'playerName',
  'strokes',
  'scoreToPar',
  'thru',
  'status',
] as const;

const golfRoundScoreUploadRowSchema = z
  .object({
    participantId: z.string().trim().min(1).optional(),
    externalId: z.string().trim().min(1).optional(),
    playerName: z.string().trim().min(1).optional(),
    strokes: z.coerce.number().int().min(1),
    scoreToPar: z.coerce.number().int(),
    thru: z.coerce.number().int().min(0).max(18).optional(),
    status: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(GOLF_ROUND_SCORE_STATUSES)),
  })
  .refine(
    (row) =>
      Boolean(row.participantId) ||
      Boolean(row.externalId) ||
      Boolean(row.playerName),
    { message: 'each row needs a participantId, externalId, or playerName' },
  );

/**
 * Parse pasted / uploaded round-score text into `applyEventGolfRoundScores`
 * request rows. Throws an `Error` with a user-facing message on malformed input.
 */
function hasNoScoreData(record: Record<string, unknown>): boolean {
  return ['strokes', 'scoreToPar', 'thru', 'status'].every((key) => {
    const value = record[key];
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- parsed CSV/JSON cell, genuinely unknown-shaped; stringifying an object here just correctly counts as "has data", not blank.
    return value === undefined || String(value).trim() === '';
  });
}

export function parseGolfRoundScoreUpload(
  text: string,
  format: BulkUploadFormat,
): GolfRoundScoreUploadRow[] {
  const records = parseDelimitedRecords(text, format);
  if (records.length === 0) {
    throw new Error('No rows found.');
  }

  // The downloadable template pre-fills one row per field golfer with blank
  // score cells; a still-blank row means "no result for this golfer" and is
  // dropped rather than rejected.
  const scored = records.filter((record) => !hasNoScoreData(record));
  if (scored.length === 0) {
    throw new Error('No scores were entered on any row.');
  }

  return scored.map((record, index) => {
    const parsed = golfRoundScoreUploadRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues.at(0);
      const field = issue?.path.at(0);
      throw new Error(
        `Row ${index + 1}${field ? ` (${String(field)})` : ''}: ${
          issue?.message ?? 'is not a valid score row'
        }.`,
      );
    }
    const { participantId, externalId, playerName, strokes, scoreToPar, thru, status } =
      parsed.data;
    const row: GolfRoundScoreUploadRow = { strokes, scoreToPar, status };
    if (participantId) row.participantId = participantId;
    if (externalId) row.externalId = externalId;
    if (playerName) row.playerName = playerName;
    if (thru !== undefined) row.thru = thru;
    return row;
  });
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
