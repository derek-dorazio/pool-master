/**
 * Internal types for the ContestEntryPick module. A pick change names no
 * `contestFormat`: the service resolves it from the parent contest per
 * plans/117 §7.1.
 */

/** One of an entry's picks in an event, as a pick change reads it under the entry's lock (#1259). */
export interface LockedEntryPick {
  id: string;
  sportEventParticipantId: string;
  /** The canonical participant, which is what tiers list. */
  participantId: string;
  lineupSlot: number | null;
}

/** What one pick change writes: a pick to remove, a pick to add, or both, as a swap does. */
export interface EntryPickWrite {
  removePickId: string | null;
  add: { sportEventParticipantId: string; lineupSlot: number } | null;
}

/**
 * One roster pick change on one entry in one event (#1259). `decide` is handed the entry's
 * picks as they stand once the entry is locked, oldest first, and answers with the write, or
 * null when there is nothing to do. It may throw to refuse the change; nothing is written then.
 */
export interface EntryPickChangeInput {
  entryId: string;
  sportEventId: string;
  decide: (picks: readonly LockedEntryPick[]) => EntryPickWrite | null;
}

/**
 * A dealt random draw (#601), as the one transaction that records it takes it: the draw's
 * audit record, and what each entry was dealt, in deal order.
 */
export interface ContestDrawRecordInput {
  contestId: string;
  seed: string;
  fieldOrder: readonly string[];
  entryOrder: readonly string[];
  drawnByUserId: string | null;
  entries: ReadonlyArray<{ entryId: string; sportEventParticipantIds: readonly string[] }>;
}
