/**
 * Internal types for the ContestEntryPick module. The DTO is re-exported
 * from `@poolmaster/shared/dto`; the insert input is service-internal and
 * deliberately omits `contestFormat` (the service resolves it from the
 * parent contest per plans/117 §7.1).
 */

export type { ContestEntryPickDto } from '@poolmaster/shared/dto';

export interface ContestEntryPickInsertInput {
  entryId: string;
  sportEventParticipantId: string;
  /** Unused since #605 removed the formats that set it; removal is tracked in #632. */
  period?: number | null;
  /** Unused since #605 removed the formats that set it; removal is tracked in #632. */
  slot?: number | null;
  /** Selection tier (tiered ROSTER). */
  tier?: string | null;
  /** Budget cost (budget ROSTER). */
  cost?: number | null;
  /** Selection round (tiered: position across tier quotas; budget: pick ordinal). */
  lineupSlot?: number | null;
  /** Contest-wide pick order at insert time. */
  pickSequence?: number | null;
  /** Whether the pick was auto-assigned (e.g. a missed-week loss). */
  isAutoPicked?: boolean;
  /** Override the default `pickedAt` (now). Used by integration fixtures. */
  pickedAt?: Date;
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
