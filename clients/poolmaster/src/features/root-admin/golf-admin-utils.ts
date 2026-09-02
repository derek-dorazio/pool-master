import { z } from 'zod';
import {
  parseDelimitedRecords,
  type BulkUploadFormat,
} from '@/features/shared/ui/bulk-upload-parse';
import type {
  AdminApplyGolfRoundScoresData,
  AdminGetGolfTournamentResponses,
  AdminGetGolfTournamentRoundsResponses,
  AdminListGolfTournamentsResponses,
  AdminPreviewGolfLeagueRosterUploadData,
} from '@/lib/api';

/**
 * plans/124 §6.3 / §6.4 — shared, pure helpers for the golf admin hub, tournament
 * list, create, and Tournament Home screens. All functions here are pure and
 * unit-tested in golf-admin-utils.test.ts, mirroring root-admin-sync-utils.ts.
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

export type AdminGolfTournamentSummary =
  AdminListGolfTournamentsResponses[200]['tournaments'][number];
export type AdminGolfTournamentDetail =
  AdminGetGolfTournamentResponses[200]['tournament'];
export type AdminGolfTournamentRound =
  AdminGetGolfTournamentRoundsResponses[200]['rounds'][number];

export type GolfSyncScope = AdminGolfTournamentSummary['syncScope'];
export type GolfTournamentStatus = AdminGolfTournamentSummary['status'];

// --- Sync scope (plans/124 §4.4) ---

export const GOLF_SYNC_SCOPE_LABELS: Record<GolfSyncScope, string> = {
  NONE: 'Manual',
  SCORES_ONLY: 'Scores synced',
  FULL: 'Fully synced',
};

export function golfSyncScopeLabel(scope: GolfSyncScope): string {
  return GOLF_SYNC_SCOPE_LABELS[scope];
}

export function golfSyncScopeTone(scope: GolfSyncScope): BadgeTone {
  if (scope === 'SCORES_ONLY') return 'info';
  if (scope === 'FULL') return 'neutral';
  return 'active';
}

/** A `FULL` tournament is fully provider-owned — read-only in the admin UI (§3.5). */
export function isAdminManagedGolfTournament(scope: GolfSyncScope): boolean {
  return scope !== 'FULL';
}

/**
 * Whether this tournament pulls anything from a provider — gates the Field
 * editor's "Load / Refresh Participant Field" action and the Score-source block
 * (§4.4a). `NONE` is a purely manual tournament.
 */
export function golfTournamentHasScoreSync(scope: GolfSyncScope): boolean {
  return scope !== 'NONE';
}

// --- Status (SportEventStatus) ---

export function formatSportEventStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function sportEventStatusTone(status: GolfTournamentStatus): BadgeTone {
  if (status === 'IN_PROGRESS') return 'live';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED' || status === 'POSTPONED') return 'warning';
  return 'neutral';
}

// --- Workflow rail lifecycle stages (plans/124 §6.3 block 2) ---

export type GolfLifecycleStageKey =
  | 'SETUP'
  | 'FIELD_OPEN'
  | 'FIELD_LOCKED'
  | 'LIVE'
  | 'COMPLETED';

export const GOLF_LIFECYCLE_STAGES: ReadonlyArray<{
  key: GolfLifecycleStageKey;
  label: string;
}> = [
  { key: 'SETUP', label: 'Setup' },
  { key: 'FIELD_OPEN', label: 'Field open' },
  { key: 'FIELD_LOCKED', label: 'Field locked' },
  { key: 'LIVE', label: 'Live' },
  { key: 'COMPLETED', label: 'Completed' },
];

export type GolfLifecycleStage = {
  key: GolfLifecycleStageKey;
  label: string;
  index: number;
};

/**
 * Which rail stage a tournament currently sits at. Returns null for CANCELLED /
 * POSTPONED — those are off the Setup → Completed rail and the caller shows a
 * plain status note instead.
 */
export function resolveGolfLifecycleStage(input: {
  status: GolfTournamentStatus;
  fieldLocked: boolean;
  releaseAt: string;
  now?: Date;
}): GolfLifecycleStage | null {
  const { status, fieldLocked } = input;

  if (status === 'CANCELLED' || status === 'POSTPONED') {
    return null;
  }

  let index: number;
  if (status === 'COMPLETED') {
    index = 4;
  } else if (status === 'IN_PROGRESS') {
    index = 3;
  } else if (fieldLocked) {
    index = 2;
  } else {
    const now = input.now ?? new Date();
    const releaseAt = new Date(input.releaseAt);
    const released =
      !Number.isNaN(releaseAt.getTime()) && now.getTime() >= releaseAt.getTime();
    index = released ? 1 : 0;
  }

  const stage = GOLF_LIFECYCLE_STAGES[index];
  return { key: stage.key, label: stage.label, index };
}

// --- Auto-lifecycle hint (plans/124 §3.6 / §6.3) ---

export type GolfAutoTransition = {
  toStatus: Extract<GolfTournamentStatus, 'IN_PROGRESS' | 'COMPLETED'>;
  at: string;
};

function sortRoundsAscending(
  rounds: readonly AdminGolfTournamentRound[],
): AdminGolfTournamentRound[] {
  return [...rounds].sort((left, right) => left.roundNumber - right.roundNumber);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

/**
 * The next transition the background scheduler (§3.6) will apply on its own, and
 * roughly when — mirrors the scheduler's own comparison: SCHEDULED → IN_PROGRESS
 * at round 1's scheduled date (falling back to the tournament start), IN_PROGRESS
 * → COMPLETED at the last round's scheduled end (falling back to the tournament
 * end). Returns null when auto-lifecycle is off, the tournament is fully
 * provider-owned, the status is terminal, or no date is available to compare
 * against.
 */
export function deriveGolfAutoTransition(input: {
  status: GolfTournamentStatus;
  autoLifecycleEnabled: boolean;
  syncScope: GolfSyncScope;
  startDate: string;
  endDate: string | null;
  rounds: readonly AdminGolfTournamentRound[];
}): GolfAutoTransition | null {
  if (!input.autoLifecycleEnabled || input.syncScope === 'FULL') {
    return null;
  }

  const ordered = sortRoundsAscending(input.rounds);

  if (input.status === 'SCHEDULED') {
    const at = firstNonEmpty(ordered[0]?.scheduledDate, input.startDate);
    return at ? { toStatus: 'IN_PROGRESS', at } : null;
  }

  if (input.status === 'IN_PROGRESS') {
    const lastRound = ordered.at(-1);
    const at = firstNonEmpty(
      lastRound?.scheduledEndAt,
      input.endDate,
      lastRound?.scheduledDate,
    );
    return at ? { toStatus: 'COMPLETED', at } : null;
  }

  return null;
}

// --- Readiness (plans/124 §6.3 tournament list) ---
//
// The shipped AdminGolfTournamentDto carries no server `readinessStatus`
// (unlike AdminEventSummaryDto), so readiness is derived here from the counts
// the DTO does carry. Kept deliberately small and branch-tested.

export type GolfTournamentReadiness = {
  label: string;
  tone: BadgeTone;
  reasons: string[];
};

export function deriveGolfTournamentReadiness(
  tournament: Pick<
    AdminGolfTournamentSummary,
    'status' | 'fieldLocked' | 'fieldCount' | 'tierCount'
  >,
): GolfTournamentReadiness {
  if (tournament.status === 'COMPLETED') {
    return { label: 'Completed', tone: 'completed', reasons: [] };
  }
  if (tournament.status === 'IN_PROGRESS') {
    return { label: 'Live', tone: 'live', reasons: [] };
  }
  if (tournament.status === 'CANCELLED' || tournament.status === 'POSTPONED') {
    return {
      label: formatSportEventStatus(tournament.status),
      tone: 'warning',
      reasons: [],
    };
  }
  if (tournament.fieldCount === 0) {
    return { label: 'Setup', tone: 'neutral', reasons: ['No field loaded'] };
  }
  if (tournament.tierCount === 0) {
    return {
      label: 'Field pending',
      tone: 'warning',
      reasons: ['No tiers defined'],
    };
  }
  if (tournament.fieldLocked) {
    return { label: 'Field locked', tone: 'locked', reasons: [] };
  }
  return { label: 'Field open', tone: 'success', reasons: [] };
}

// --- datetime-local <input> <-> ISO ---

/**
 * A `<input type="datetime-local">` value ("2026-03-12T13:00", local, no zone) to
 * the ISO string the golf admin API expects, or undefined when blank/invalid.
 */
export function localDateTimeInputToIso(
  value: string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// --- Provider resolution (plans/124 §4.4) ---
//
// adminListProviderCatalogEvents needs a providerId. There is no dedicated
// "which provider serves this sport" endpoint in this slice, so the golf
// provider is resolved from the provider-health list the sync lane already
// exposes: the first provider whose sportsCovered includes GOLF.

export function resolveGolfProviderId(
  providers:
    | ReadonlyArray<{ providerId: string; sportsCovered: readonly string[] }>
    | undefined,
): string | null {
  return (
    providers?.find((provider) => provider.sportsCovered.includes('GOLF'))
      ?.providerId ?? null
  );
}

// --- Field editor (plans/124 §6.3 / §4.4a) ---

/**
 * The "Load Participant Field" / "Refresh Participant Field" header action is one
 * endpoint (`adminRefreshGolfTournamentField`) with a client-computed label:
 * "Load" while the field is still empty, "Refresh" once it has entries (§4.4a).
 */
export function golfParticipantFieldActionLabel(
  fieldCount: number,
): 'Load Participant Field' | 'Refresh Participant Field' {
  return fieldCount === 0
    ? 'Load Participant Field'
    : 'Refresh Participant Field';
}

// --- League roster bulk upload (plans/124 §6.3 Tour Home / §6.4) ---
//
// The Tour Home roster editor and the round-scores editor share one
// paste/upload/preview/apply flow (BulkUploadPanel). Each screen supplies its
// own row shape + parser config; this is the roster one — `externalId` or
// `playerName` (or an explicit `participantId`) plus `worldRanking`.

export type GolfRosterUploadRow =
  AdminPreviewGolfLeagueRosterUploadData['body']['rows'][number];

export const GOLF_ROSTER_UPLOAD_HEADERS = [
  'externalId',
  'playerName',
  'worldRanking',
] as const;

const golfRosterUploadRowSchema = z
  .object({
    participantId: z.string().trim().min(1).optional(),
    externalId: z.string().trim().min(1).optional(),
    playerName: z.string().trim().min(1).optional(),
    worldRanking: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (row) =>
      Boolean(row.participantId) ||
      Boolean(row.externalId) ||
      Boolean(row.playerName),
    { message: 'each row needs a participantId, externalId, or playerName' },
  );

/**
 * Parse pasted / uploaded league-roster text into `adminPreviewGolfLeagueRosterUpload`
 * request rows. Throws an `Error` with a user-facing message on malformed input
 * or a row missing every identifier — the panel renders that inline.
 */
export function parseGolfRosterUpload(
  text: string,
  format: BulkUploadFormat,
): GolfRosterUploadRow[] {
  // parseDelimitedRecords rejects empty input / a header-only CSV; an empty
  // JSON array (`[]`) is the only way to reach zero records here.
  const records = parseDelimitedRecords(text, format);
  if (records.length === 0) {
    throw new Error('No rows found.');
  }

  return records.map((record, index) => {
    const parsed = golfRosterUploadRowSchema.safeParse(record);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      throw new Error(
        `Row ${index + 1}: ${issue?.message ?? 'is not a valid roster row'}.`,
      );
    }
    const row: GolfRosterUploadRow = {};
    if (parsed.data.participantId) row.participantId = parsed.data.participantId;
    if (parsed.data.externalId) row.externalId = parsed.data.externalId;
    if (parsed.data.playerName) row.playerName = parsed.data.playerName;
    if (parsed.data.worldRanking !== undefined) {
      row.worldRanking = parsed.data.worldRanking;
    }
    return row;
  });
}

// --- Round-score bulk upload (plans/124 §6.3 Round scores / §6.4) ---
//
// plans/124 §6.3 documents the CSV header as `externalId,playerName,strokes,thru,status`,
// but the generated `adminApplyGolfRoundScores` request row also requires `scoreToPar`
// (not optional) and `status` is a fixed 5-value enum. The template + parser therefore
// carry `scoreToPar` too; the discrepancy is flagged in the pool-master-r11 close note.

export type GolfRoundScoreUploadRow =
  AdminApplyGolfRoundScoresData['body']['rows'][number];
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
const _golfRoundScoreStatusExhaustive: _GolfRoundScoreStatusExhaustive = true;
void _golfRoundScoreStatusExhaustive;

const GOLF_ROUND_STATUS_LABEL: Record<GolfRoundScoreStatus, string> = {
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DNF: 'Did not finish',
  DSQ: 'Disqualified',
  MISSED_CUT: 'Missed cut',
};

/** Human-readable label for a golf round-result status enum value. */
export function formatGolfRoundStatus(status: string): string {
  return (
    GOLF_ROUND_STATUS_LABEL[status as GolfRoundScoreStatus] ??
    status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export const GOLF_ROUND_SCORE_UPLOAD_HEADERS = [
  'externalId',
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
    strokes: z.coerce.number().int().nonnegative(),
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
 * Parse pasted / uploaded round-score text into `adminApplyGolfRoundScores`
 * request rows. Throws an `Error` with a user-facing message on malformed input.
 */
function hasNoScoreData(record: Record<string, unknown>): boolean {
  return ['strokes', 'scoreToPar', 'thru', 'status'].every((key) => {
    const value = record[key];
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
      const [issue] = parsed.error.issues;
      const field = issue?.path?.[0];
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
