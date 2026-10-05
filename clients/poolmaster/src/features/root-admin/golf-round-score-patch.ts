/**
 * Draft-to-patch logic for the golf round score corrections grid.
 *
 * Split out of `golf-round-score-corrections-card.tsx` for
 * `react-refresh/only-export-components` (#345 Phase 0, from #167): that module
 * exports the card component, so `buildRoundScorePatch` beside it broke Fast
 * Refresh. `isNonNegInt` and `rowHasInvalid` moved with it -- all three are the
 * same validation concern, and the card imports the ones it still uses.
 */
import type { UpdateGolfRoundScoreRequest } from "@/lib/api";
import type { GolfRoundScoreRow, GolfRoundScoreStatus } from "./golf-admin-utils";

type ScoreRow = GolfRoundScoreRow;
type ScorePatch = UpdateGolfRoundScoreRequest;

export type RowDraft = {
  strokes?: string;
  thru?: string;
  status?: GolfRoundScoreStatus;
};

/** A non-negative integer as typed; the grid also uses it per keystroke. */
export function isNonNegInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

/** The changed-fields patch for one correction row, or null when nothing changed. */
export function buildRoundScorePatch(
  row: ScoreRow,
  draft: RowDraft | undefined,
): ScorePatch | null {
  if (!draft) {
    return null;
  }
  const patch: ScorePatch = {};
  if (
    draft.strokes !== undefined &&
    isNonNegInt(draft.strokes) &&
    Number(draft.strokes) !== row.strokes
  ) {
    patch.strokes = Number(draft.strokes);
  }
  if (
    draft.thru !== undefined &&
    isNonNegInt(draft.thru) &&
    Number(draft.thru) !== row.thru
  ) {
    patch.thru = Number(draft.thru);
  }
  if (draft.status !== undefined && draft.status !== row.status) {
    patch.status = draft.status;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export function rowHasInvalid(draft: RowDraft | undefined): boolean {
  if (!draft) return false;
  return (
    (draft.strokes !== undefined && draft.strokes.trim() !== '' && !isNonNegInt(draft.strokes)) ||
    (draft.thru !== undefined && draft.thru.trim() !== '' && !isNonNegInt(draft.thru))
  );
}
