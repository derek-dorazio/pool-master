import type {
  AdminGetGolfTournamentResponses,
  AdminGetGolfTournamentRoundsResponses,
  AdminListGolfTournamentsResponses,
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
