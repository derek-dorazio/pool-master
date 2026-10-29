/**
 * Internal types for the ContestEntryPick module. A pick change names no
 * `contestFormat`: the service resolves it from the parent contest per
 * plans/117 §7.1.
 */

import type { ContestEntryStatus } from '@poolmaster/shared/domain';

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
  /** The pick to add; `participantId` is its canonical participant, so the lineup the write leaves is known without a read. */
  add: { sportEventParticipantId: string; participantId: string; lineupSlot: number } | null;
}

/** An entry's lineup and status in one event, as read under the entry's lock (#1300). */
export interface LockedEntryEvent {
  /** Its picks in the event, oldest first. */
  picks: readonly LockedEntryPick[];
  status: ContestEntryStatus;
}

/**
 * Under the entry's lock, after any pick write: the status to give the entry in the event, or
 * null to leave it as it is (#1300). It may throw to refuse; nothing is written then.
 */
export type EntryEventSettle<State extends LockedEntryEvent = LockedEntryEvent> = (state: State) => ContestEntryStatus | null;

/**
 * One roster pick change on one entry in one event (#1259). `decide` is handed the entry's
 * picks as they stand once the entry is locked, oldest first, and answers with the write, or
 * null when there is nothing to do. `settle` then sees the lineup the write left and the
 * entry's status under the same lock, so a submit that committed while this change waited is
 * judged too (#1300). Either may throw to refuse the change; nothing is written then.
 */
export interface EntryPickChangeInput {
  entryId: string;
  sportEventId: string;
  /** When a status `settle` sets is stamped. */
  at: Date;
  decide: (picks: readonly LockedEntryPick[]) => EntryPickWrite | null;
  settle: EntryEventSettle<LockedEntryEvent & { picksChanged: boolean }>;
}

/** Settling one entry's status in one event under its lock, with no pick write: a submit (#1300). */
export interface EntryEventSettleInput {
  entryId: string;
  sportEventId: string;
  at: Date;
  settle: EntryEventSettle;
}

/** What a locked change left: whether picks were written, and the entry's status in the event. */
export interface EntryChangeResult {
  picksChanged: boolean;
  status: ContestEntryStatus;
  /** When the event was submitted; null unless `status` is SUBMITTED. */
  submittedAt: Date | null;
  /** Whether `settle` changed the status. */
  statusChanged: boolean;
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
