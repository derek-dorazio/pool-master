import type {
  AdminGetGolfTournamentFieldResponses,
  AdminUpdateGolfFieldEntriesData,
} from '@/lib/api';

export type GolfFieldEntry =
  AdminGetGolfTournamentFieldResponses[200]['entries'][number];
export type GolfFieldInactiveReason = NonNullable<GolfFieldEntry['inactiveReason']>;
export type GolfFieldPatch =
  AdminUpdateGolfFieldEntriesData['body']['entries'][number];

export type GolfFieldNumericKey =
  | 'worldRanking'
  | 'oddsToWin'
  | 'seedNumber'
  | 'price';

export type GolfFieldRowDraft = {
  isActive?: boolean;
  inactiveReason?: GolfFieldInactiveReason;
  worldRanking?: string;
  oddsToWin?: string;
  seedNumber?: string;
  price?: string;
};

export const GOLF_FIELD_NUMERIC_KEYS: readonly GolfFieldNumericKey[] = [
  'worldRanking',
  'oddsToWin',
  'seedNumber',
  'price',
];

export const GOLF_FIELD_INACTIVE_REASONS: readonly GolfFieldInactiveReason[] = [
  'WITHDRAWN',
  'CUT',
  'ELIMINATED',
];

function isPositiveInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0;
}

function isNonNegativeInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

function isPositiveNumber(raw: string): boolean {
  const value = Number(raw.trim());
  return raw.trim() !== '' && Number.isFinite(value) && value > 0;
}

/**
 * plans/124 §6.3 Field editor — per-cell validity for the four editable numeric
 * columns. An empty string means "not edited / left as-is", which is valid.
 */
export const GOLF_FIELD_NUMERIC_VALIDATORS: Record<
  GolfFieldNumericKey,
  (raw: string) => boolean
> = {
  worldRanking: isPositiveInt,
  seedNumber: isPositiveInt,
  price: isNonNegativeInt,
  oddsToWin: isPositiveNumber,
};

/**
 * The string shown in a numeric cell: the user's draft edit if present, else the
 * server value coalesced to '' (a golfer just bulk-added has no derived
 * odds/seed/price yet, so `entry[key]` can be null despite the generated type).
 */
export function golfFieldCellValue(
  entry: GolfFieldEntry,
  rowDraft: GolfFieldRowDraft | undefined,
  key: GolfFieldNumericKey,
): string {
  const drafted = rowDraft?.[key];
  if (drafted !== undefined) {
    return drafted;
  }
  const serverValue = entry[key] as number | null | undefined;
  return serverValue === null || serverValue === undefined
    ? ''
    : String(serverValue);
}

export function golfFieldCellInvalid(
  raw: string,
  key: GolfFieldNumericKey,
): boolean {
  return raw.trim() !== '' && !GOLF_FIELD_NUMERIC_VALIDATORS[key](raw);
}

/** How many draft numeric cells across the field currently hold an invalid value. */
export function golfFieldInvalidCount(
  draft: Record<string, GolfFieldRowDraft>,
): number {
  let count = 0;
  for (const rowDraft of Object.values(draft)) {
    for (const key of GOLF_FIELD_NUMERIC_KEYS) {
      const raw = rowDraft[key];
      if (raw !== undefined && golfFieldCellInvalid(raw, key)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Build the minimal `adminUpdateGolfFieldEntries` row for one golfer — only the
 * fields whose draft value both parses and differs from the server value.
 * Returns null when nothing changed. An inactive golfer whose reason changed is
 * a change even when `isActive` itself did not.
 */
export function buildGolfFieldPatch(
  entry: GolfFieldEntry,
  rowDraft: GolfFieldRowDraft,
): GolfFieldPatch | null {
  const patch: GolfFieldPatch = {
    sportEventParticipantId: entry.sportEventParticipantId,
  };
  let changed = false;

  const nextActive = rowDraft.isActive ?? entry.isActive;
  const nextReason = nextActive
    ? undefined
    : rowDraft.inactiveReason ?? entry.inactiveReason ?? 'WITHDRAWN';
  const activeChanged =
    rowDraft.isActive !== undefined && nextActive !== entry.isActive;
  const reasonChanged = !nextActive && nextReason !== entry.inactiveReason;

  if (activeChanged || reasonChanged) {
    patch.isActive = nextActive;
    if (!nextActive) {
      patch.inactiveReason = nextReason;
    }
    changed = true;
  }

  for (const key of GOLF_FIELD_NUMERIC_KEYS) {
    const raw = rowDraft[key];
    if (raw === undefined || !GOLF_FIELD_NUMERIC_VALIDATORS[key](raw)) {
      continue;
    }
    const value = Number(raw);
    if (value !== entry[key]) {
      patch[key] = value;
      changed = true;
    }
  }

  return changed ? patch : null;
}

/** All non-null patches for the current draft, in field order. */
export function buildGolfFieldPatches(
  entries: readonly GolfFieldEntry[],
  draft: Record<string, GolfFieldRowDraft>,
): GolfFieldPatch[] {
  const patches: GolfFieldPatch[] = [];
  for (const entry of entries) {
    const rowDraft = draft[entry.sportEventParticipantId];
    if (!rowDraft) {
      continue;
    }
    const patch = buildGolfFieldPatch(entry, rowDraft);
    if (patch) {
      patches.push(patch);
    }
  }
  return patches;
}
