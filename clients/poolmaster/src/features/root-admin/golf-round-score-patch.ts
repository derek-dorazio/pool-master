/**
 * Draft-to-patch logic for the golf round score corrections grid.
 *
 * Split out of `golf-round-score-corrections-card.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): that module
 * exports the card component, so `buildRoundScorePatch` beside it broke Fast
 * Refresh. `isNonNegInt` and `rowHasInvalid` moved with it -- all three are the
 * same validation concern. #374: `isStrokes` and `isThru` hold the server's bounds, and
 * the grid checks each keystroke with them.
 *
 * #116: every value is the admin's. A row edits strokes, to par, thru, status and
 * completed at; each cell starts from what is stored and none is filled from another.
 */
import type { UpdateGolfRoundScoreRequest } from "@/lib/api";
import { dateTimeLocalValueToIso, toDateTimeLocalValue } from "@/features/shared/ui";
import type { GolfRoundScoreRow, GolfRoundScoreStatus } from "./sport-admin-utils";

type ScoreRow = GolfRoundScoreRow;
type ScorePatch = UpdateGolfRoundScoreRequest;

export type RowDraft = {
  strokes?: string;
  scoreToPar?: string;
  thru?: string;
  status?: GolfRoundScoreStatus;
  /** As a `datetime-local` input holds it, in the member's time zone (#1061); blank is none. */
  completedAt?: string;
  /**
   * The input holds a half-typed value (its `validity.badInput`). It then reports '',
   * which must not read as "clear the stored time": the row is invalid until finished.
   */
  completedAtIncomplete?: boolean;
};

/** A non-negative integer as typed. */
export function isNonNegInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

/** Strokes as typed: a whole number of at least 1, the server's bound (#374). */
export function isStrokes(raw: string): boolean {
  return isNonNegInt(raw) && Number(raw) >= 1;
}

/** Holes completed as typed: 0 to 18, the server's bound; playoff holes are not part of any round (#374). */
export function isThru(raw: string): boolean {
  return isNonNegInt(raw) && Number(raw) <= 18;
}

/** A whole number with an optional sign, as a score to par is typed ("-3", "+2", "0"). */
export function isSignedInt(raw: string): boolean {
  return /^[+-]?\d+$/.test(raw.trim());
}

function isDateTimeInput(raw: string, timeZone: string): boolean {
  return raw === '' || dateTimeLocalValueToIso(raw, timeZone) !== undefined;
}

/** The changed-fields patch for one correction row, or null when nothing changed. */
export function buildRoundScorePatch(
  row: ScoreRow,
  draft: RowDraft | undefined,
  timeZone: string,
): ScorePatch | null {
  if (!draft) {
    return null;
  }
  const patch: ScorePatch = {};
  if (
    draft.strokes !== undefined &&
    isStrokes(draft.strokes) &&
    Number(draft.strokes) !== row.strokes
  ) {
    patch.strokes = Number(draft.strokes);
  }
  if (draft.thru !== undefined && draft.thru.trim() === '') {
    // A blanked thru clears the stored one: the golfer has not started the round.
    if (row.thru !== null) patch.thru = null;
  } else if (
    draft.thru !== undefined &&
    isThru(draft.thru) &&
    Number(draft.thru) !== row.thru
  ) {
    patch.thru = Number(draft.thru);
  }
  if (
    draft.scoreToPar !== undefined &&
    isSignedInt(draft.scoreToPar) &&
    Number(draft.scoreToPar) !== row.scoreToPar
  ) {
    patch.scoreToPar = Number(draft.scoreToPar);
  }
  if (draft.status !== undefined && draft.status !== row.status) {
    patch.status = draft.status;
  }
  if (
    draft.completedAt !== undefined &&
    !draft.completedAtIncomplete &&
    isDateTimeInput(draft.completedAt, timeZone) &&
    draft.completedAt !== toDateTimeLocalValue(row.completedAt, timeZone)
  ) {
    patch.completedAt = draft.completedAt === '' ? null : dateTimeLocalValueToIso(draft.completedAt, timeZone) ?? null;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export function rowHasInvalid(draft: RowDraft | undefined, timeZone: string): boolean {
  if (!draft) return false;
  return (
    (draft.strokes !== undefined && draft.strokes.trim() !== '' && !isStrokes(draft.strokes)) ||
    (draft.scoreToPar !== undefined && draft.scoreToPar.trim() !== '' && !isSignedInt(draft.scoreToPar)) ||
    (draft.thru !== undefined && draft.thru.trim() !== '' && !isThru(draft.thru)) ||
    Boolean(draft.completedAtIncomplete) ||
    (draft.completedAt !== undefined && !isDateTimeInput(draft.completedAt, timeZone))
  );
}
