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
  /** Per-format period — week (SURVIVOR), draft round (BRACKET). */
  period?: number | null;
  /** Per-format slot — matchup index, confidence rank, predicted position. */
  slot?: number | null;
  /** Selection tier (tiered ROSTER). */
  tier?: string | null;
  /** Budget cost (budget ROSTER). */
  cost?: number | null;
  /** Snake-draft round number (existing draft mechanism). */
  draftRound?: number | null;
  /** Snake-draft pick order (existing draft mechanism). */
  draftPickNumber?: number | null;
  /** Whether the pick was auto-assigned (snake-draft auto-pick, missed-week loss). */
  isAutoPicked?: boolean;
  /** Override the default `pickedAt` (now). Used by integration fixtures. */
  pickedAt?: Date;
}
