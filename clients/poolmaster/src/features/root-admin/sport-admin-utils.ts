import { z } from 'zod';
import {
  parseDelimitedRecords,
  type BulkUploadFormat,
} from '@/features/shared/ui/bulk-upload-parse';
import type {
  GolfRoundScoreUploadRequest,
  ParticipantDto,
  ParticipantLeagueAffiliationUploadRequest,
  SportEventDto,
  SportEventParticipantDto,
  SportEventRoundDto,
} from '@/lib/api';
import { SportEventStatus, getSportDefinition, type ParticipantRoundStatus, type Sport } from '@poolmaster/shared/domain';

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
export type SportEventDtoSyncScope = SportEventDto['syncScope'];
export type SportEventDtoStatus = SportEventDto['status'];

// --- Sync scope (plans/124 §4.4) ---

export const SYNC_SCOPE_LABELS: Record<SportEventDtoSyncScope, string> = {
  NONE: 'Manual',
  SCORES_ONLY: 'Scores synced',
};

export function syncScopeLabel(scope: SportEventDtoSyncScope): string {
  return SYNC_SCOPE_LABELS[scope];
}

export function syncScopeTone(scope: SportEventDtoSyncScope): BadgeTone {
  if (scope === 'SCORES_ONLY') return 'info';
  return 'active';
}

/**
 * Whether this tournament pulls anything from a provider — gates the Field
 * editor's "Load / Refresh Participant Field" action and the Score-source block
 * (§4.4a). `NONE` is a purely manual tournament.
 */
export function sportEventHasScoreSync(scope: SportEventDtoSyncScope): boolean {
  return scope !== 'NONE';
}

// --- Status (SportEventStatus) ---

export function formatSportEventStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function sportEventStatusTone(status: SportEventDtoStatus): BadgeTone {
  if (status === 'IN_PROGRESS') return 'live';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED' || status === 'POSTPONED') return 'warning';
  return 'neutral';
}

// --- Workflow rail lifecycle stages (plans/124 §6.3 block 2, #431) ---

export type EventLifecycleStageKey =
  | 'DRAFT'
  | 'RELEASED'
  | 'LIVE'
  | 'COMPLETED';

export const EVENT_LIFECYCLE_STAGES: ReadonlyArray<{
  key: EventLifecycleStageKey;
  label: string;
}> = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'RELEASED', label: 'Released for contests' },
  { key: 'LIVE', label: 'Live' },
  { key: 'COMPLETED', label: 'Completed' },
];

export type EventLifecycleStage = {
  key: EventLifecycleStageKey;
  label: string;
  index: number;
};

const STAGE_INDEX_BY_STATUS: Partial<Record<SportEventDtoStatus, number>> = {
  DRAFT: 0,
  SCHEDULED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

/**
 * Which rail stage a tournament currently sits at, straight from its status. Returns null
 * for CANCELLED / POSTPONED — those are off the Draft → Completed rail and the caller shows
 * a plain status note instead.
 */
export function resolveEventLifecycleStage(status: SportEventDtoStatus): EventLifecycleStage | null {
  const index = STAGE_INDEX_BY_STATUS[status];
  if (index === undefined) {
    return null;
  }
  const stage = EVENT_LIFECYCLE_STAGES[index];
  return { key: stage.key, label: stage.label, index };
}

// --- Release (#431) ---

/**
 * What still stops a draft tournament being released, in the admin's words: the same checks
 * the server makes. Empty when it is ready, or when it is not a draft. The tier and price checks
 * read the root admin's counts, which only a root admin's read carries (#1198).
 */
export function describeEventReleaseBlockers(
  tournament: Pick<SportEventDto, 'sport' | 'status' | 'startDate' | 'loadedParticipantCount' | 'adminCounts' | 'pricing'>,
  now: Date = new Date(),
): string[] {
  if (tournament.status !== SportEventStatus.DRAFT) {
    return [];
  }
  const { participant } = getSportDefinition(tournament.sport).vocabulary;
  const blockers: string[] = [];
  if (new Date(tournament.startDate).getTime() <= now.getTime()) {
    blockers.push('Its start time has passed, so it can no longer be released.');
  }
  if (tournament.loadedParticipantCount === 0) {
    blockers.push('Load the field.');
  }
  const counts = tournament.adminCounts;
  if (counts !== null && counts.untieredParticipantCount > 0) {
    blockers.push(
      counts.untieredParticipantCount === 1
        ? `Put the 1 active ${participant.one} without a tier into a tier.`
        : `Put the ${counts.untieredParticipantCount} active ${participant.many} without a tier into tiers.`,
    );
  }
  // No entry could pick from a tier nobody is in, so a tiered contest on it could never be completed.
  for (const label of counts?.emptyTierLabels ?? []) {
    blockers.push(`${label} has no ${participant.many}. Move ${participant.many} into it or delete it.`);
  }
  if (!tournament.pricing) {
    blockers.push('Assign prices on the Tiers page.');
  } else if (counts !== null && counts.unpricedParticipantCount > 0) {
    blockers.push(
      counts.unpricedParticipantCount === 1
        ? `Price the 1 active ${participant.one} without a price.`
        : `Price the ${counts.unpricedParticipantCount} active ${participant.many} without a price.`,
    );
  }
  return blockers;
}

/** Tiers and prices lock when the tournament is released (#431). */
export function eventTiersLocked(status: SportEventDtoStatus): boolean {
  return status !== 'DRAFT';
}

// --- Auto-lifecycle hint (plans/124 §3.6 / §6.3) ---

export type EventAutoTransition = {
  toStatus: Extract<SportEventDtoStatus, 'IN_PROGRESS' | 'COMPLETED'>;
  at: string;
};

function sortRoundsAscending(
  rounds: readonly SportEventRoundDto[],
): SportEventRoundDto[] {
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
 * end). Returns null when auto-lifecycle is off, the status is terminal, or no
 * date is available to compare against.
 */
export function deriveEventAutoTransition(input: {
  status: SportEventDtoStatus;
  autoLifecycleEnabled: boolean;
  startDate: string;
  endDate: string | null;
  rounds: readonly SportEventRoundDto[];
}): EventAutoTransition | null {
  if (!input.autoLifecycleEnabled) {
    return null;
  }

  const ordered = sortRoundsAscending(input.rounds);

  if (input.status === SportEventStatus.SCHEDULED) {
    const at = firstNonEmpty(ordered[0]?.scheduledDate, input.startDate);
    return at ? { toStatus: 'IN_PROGRESS', at } : null;
  }

  if (input.status === SportEventStatus.IN_PROGRESS) {
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
// SportEventDto's own `readinessStatus` answers whether contests can be built on the event;
// this answers where the admin's setup work stands (field, then tiers), from the counts the
// DTO carries. Kept deliberately small and branch-tested.

export type SportEventReadiness = {
  label: string;
  tone: BadgeTone;
  reasons: string[];
};

/** A draft's readiness reads the root admin's counts, which only a root admin's read carries (#1198). */
export function deriveSportEventReadiness(
  tournament: Pick<SportEventDto, 'sport' | 'status' | 'loadedParticipantCount' | 'tierCount' | 'adminCounts' | 'pricing'>,
): SportEventReadiness {
  if (tournament.status === SportEventStatus.COMPLETED) {
    return { label: 'Completed', tone: 'completed', reasons: [] };
  }
  if (tournament.status === SportEventStatus.IN_PROGRESS) {
    return { label: 'Live', tone: 'live', reasons: [] };
  }
  if (tournament.status === SportEventStatus.CANCELLED || tournament.status === SportEventStatus.POSTPONED) {
    return {
      label: formatSportEventStatus(tournament.status),
      tone: 'warning',
      reasons: [],
    };
  }
  if (tournament.status !== SportEventStatus.DRAFT) {
    return { label: 'Released', tone: 'success', reasons: [] };
  }
  if (tournament.loadedParticipantCount === 0) {
    return { label: 'Setup', tone: 'neutral', reasons: ['No field loaded'] };
  }
  if (tournament.tierCount === 0) {
    return {
      label: 'Field pending',
      tone: 'warning',
      reasons: ['No tiers defined'],
    };
  }
  // A count of the event's participants, in its sport's words: "4 golfers", "1 horse".
  const { participant } = getSportDefinition(tournament.sport).vocabulary;
  const participants = (count: number) => `${count} ${count === 1 ? participant.one : participant.many}`;
  const counts = tournament.adminCounts;
  if (counts !== null && counts.untieredParticipantCount > 0) {
    return {
      label: 'Tiers pending',
      tone: 'warning',
      reasons: [`${participants(counts.untieredParticipantCount)} without a tier`],
    };
  }
  if (counts !== null && counts.emptyTierLabels.length > 0) {
    return {
      label: 'Tiers pending',
      tone: 'warning',
      reasons: counts.emptyTierLabels.map((label) => `${label} has no ${participant.many}`),
    };
  }
  if (!tournament.pricing) {
    return { label: 'Prices pending', tone: 'warning', reasons: ['No prices assigned'] };
  }
  if (counts !== null && counts.unpricedParticipantCount > 0) {
    return {
      label: 'Prices pending',
      tone: 'warning',
      reasons: [`${participants(counts.unpricedParticipantCount)} without a price`],
    };
  }
  return { label: 'Ready to release', tone: 'info', reasons: [] };
}

// --- Provider resolution (plans/124 §4.4) ---
//
// listProviderCatalogEvents needs a providerId. There is no dedicated
// "which provider serves this sport" endpoint in this slice, so the golf
// provider is resolved from the provider-health list the sync lane already
// exposes: the first provider whose sportsCovered includes the sport.

export function resolveSportProviderId(
  providers:
    | ReadonlyArray<{ providerId: string; sportsCovered: readonly string[] }>
    | undefined,
  sport: Sport,
): string | null {
  return (
    providers?.find((provider) => provider.sportsCovered.includes(sport))
      ?.providerId ?? null
  );
}

// --- Player status (Participant.status) ---

type BadgeToneLite = 'active' | 'inactive' | 'warning';
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
const _participantStatusExhaustive: _ParticipantStatusExhaustive = true;
void _participantStatusExhaustive;

const PARTICIPANT_STATUS_LABELS: Record<ManagedParticipantStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  RETIRED: 'Retired',
  SUSPENDED: 'Suspended',
};

/** A golfer's status in plain words, for badges, rows and options. */
export function participantStatusLabel(status: ManagedParticipantStatus): string {
  return PARTICIPANT_STATUS_LABELS[status];
}

export function participantStatusTone(status: ManagedParticipantStatus): BadgeToneLite {
  if (status === 'ACTIVE') return 'active';
  if (status === 'SUSPENDED') return 'warning';
  return 'inactive';
}

// --- Field editor (plans/124 §6.3 / §4.4a) ---

/**
 * The "Load Participant Field" / "Refresh Participant Field" header action is one
 * endpoint (`refreshEventParticipants`) with a client-computed label:
 * "Load" while the field is still empty, "Refresh" once it has entries (§4.4a).
 */
export function participantFieldActionLabel(
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
// `playerName` (or an explicit `participantId`) plus `ranking`.

export type RosterUploadRow =
  ParticipantLeagueAffiliationUploadRequest['rows'][number];

export const ROSTER_UPLOAD_HEADERS = [
  'externalId',
  'playerName',
  'ranking',
] as const;

const rosterUploadRowSchema = z
  .object({
    participantId: z.string().trim().min(1).optional(),
    externalId: z.string().trim().min(1).optional(),
    playerName: z.string().trim().min(1).optional(),
    ranking: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (row) =>
      Boolean(row.participantId) ||
      Boolean(row.externalId) ||
      Boolean(row.playerName),
    { message: 'each row needs a participantId, externalId, or playerName' },
  );

/**
 * Parse pasted / uploaded league-roster text into `previewParticipantLeagueAffiliationUpload`
 * request rows. Throws an `Error` with a user-facing message on malformed input
 * or a row missing every identifier — the panel renders that inline.
 */
export function parseRosterUpload(
  text: string,
  format: BulkUploadFormat,
): RosterUploadRow[] {
  // parseDelimitedRecords rejects empty input / a header-only CSV; an empty
  // JSON array (`[]`) is the only way to reach zero records here.
  const records = parseDelimitedRecords(text, format);
  if (records.length === 0) {
    throw new Error('No rows found.');
  }

  return records.map((record, index) => {
    const parsed = rosterUploadRowSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues.at(0);
      throw new Error(
        `Row ${index + 1}: ${issue?.message ?? 'is not a valid roster row'}.`,
      );
    }
    const row: RosterUploadRow = {};
    if (parsed.data.participantId) row.participantId = parsed.data.participantId;
    if (parsed.data.externalId) row.externalId = parsed.data.externalId;
    if (parsed.data.playerName) row.playerName = parsed.data.playerName;
    if (parsed.data.ranking !== undefined) {
      row.ranking = parsed.data.ranking;
    }
    return row;
  });
}

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
export function formatGolfRoundStatus(status: GolfRoundScoreStatus): string {
  return GOLF_ROUND_STATUS_LABEL[status];
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
