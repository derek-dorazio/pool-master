import type { SportEventParticipantDto, UpdateSportEventParticipantsRequest } from '@/lib/api';

// #236: a field row is the shared SportEventParticipant; its price sits on the valuation.
export type EventFieldEntry = SportEventParticipantDto;
export type EventFieldInactiveReason = NonNullable<EventFieldEntry['inactiveReason']>;
export type EventFieldPatch = UpdateSportEventParticipantsRequest['participants'][number];

export type EventFieldNumericKey =
  | 'ranking'
  | 'oddsToWin'
  | 'seedNumber'
  | 'price';

export type EventFieldRowDraft = {
  isActive?: boolean;
  inactiveReason?: EventFieldInactiveReason;
  ranking?: string;
  oddsToWin?: string;
  seedNumber?: string;
  price?: string;
};

export const EVENT_FIELD_NUMERIC_KEYS: readonly EventFieldNumericKey[] = [
  'ranking',
  'oddsToWin',
  'seedNumber',
  'price',
];

export const EVENT_FIELD_INACTIVE_REASONS: readonly EventFieldInactiveReason[] = [
  'WITHDRAWN',
  'ELIMINATED',
];

/** Rank and seed are stored as 32-bit integers, so the server refuses anything larger. */
const MAX_INT32 = 2147483647;

function isPositiveInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim()) && Number(raw) > 0 && Number(raw) <= MAX_INT32;
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
export const EVENT_FIELD_NUMERIC_VALIDATORS: Record<
  EventFieldNumericKey,
  (raw: string) => boolean
> = {
  ranking: isPositiveInt,
  seedNumber: isPositiveInt,
  price: isNonNegativeInt,
  oddsToWin: isPositiveNumber,
};

/** The server value of one editable numeric column; price is the valuation's. */
export function eventFieldServerValue(
  entry: EventFieldEntry,
  key: EventFieldNumericKey,
): number | null {
  return key === 'price' ? entry.valuation?.price ?? null : entry[key];
}

/**
 * The string shown in a numeric cell: the user's draft edit if present, else the
 * server value coalesced to '' (a golfer just bulk-added has no derived
 * odds/seed/price yet).
 */
export function eventFieldCellValue(
  entry: EventFieldEntry,
  rowDraft: EventFieldRowDraft | undefined,
  key: EventFieldNumericKey,
): string {
  const drafted = rowDraft?.[key];
  if (drafted !== undefined) {
    return drafted;
  }
  const serverValue = eventFieldServerValue(entry, key);
  return serverValue === null ? '' : String(serverValue);
}

export function eventFieldCellInvalid(
  raw: string,
  key: EventFieldNumericKey,
): boolean {
  return raw.trim() !== '' && !EVENT_FIELD_NUMERIC_VALIDATORS[key](raw);
}

/** How many draft numeric cells across the field currently hold an invalid value. */
export function eventFieldInvalidCount(
  draft: Partial<Record<string, EventFieldRowDraft>>,
): number {
  let count = 0;
  for (const rowDraft of Object.values(draft)) {
    for (const key of EVENT_FIELD_NUMERIC_KEYS) {
      const raw = rowDraft?.[key];
      if (raw !== undefined && eventFieldCellInvalid(raw, key)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Build the minimal `updateEventParticipants` row for one golfer — only the
 * fields whose draft value both parses and differs from the server value.
 * Returns null when nothing changed. An inactive golfer whose reason changed is
 * a change even when `isActive` itself did not.
 */
export function buildEventFieldPatch(
  entry: EventFieldEntry,
  rowDraft: EventFieldRowDraft,
): EventFieldPatch | null {
  const patch: EventFieldPatch = {
    sportEventParticipantId: entry.id,
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

  for (const key of EVENT_FIELD_NUMERIC_KEYS) {
    const raw = rowDraft[key];
    if (raw === undefined || !EVENT_FIELD_NUMERIC_VALIDATORS[key](raw)) {
      continue;
    }
    const value = Number(raw);
    if (value !== eventFieldServerValue(entry, key)) {
      patch[key] = value;
      changed = true;
    }
  }

  return changed ? patch : null;
}

/** All non-null patches for the current draft, in field order. */
export function buildEventFieldPatches(
  entries: readonly EventFieldEntry[],
  draft: Partial<Record<string, EventFieldRowDraft>>,
): EventFieldPatch[] {
  const patches: EventFieldPatch[] = [];
  for (const entry of entries) {
    const rowDraft = draft[entry.id];
    if (!rowDraft) {
      continue;
    }
    const patch = buildEventFieldPatch(entry, rowDraft);
    if (patch) {
      patches.push(patch);
    }
  }
  return patches;
}
