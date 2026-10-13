/**
 * Race result mapper (#622) — a finishing order's dry run → its response, with the rollup the
 * results card shows.
 */

import type { RaceResultPreviewResponse } from '@poolmaster/shared/dto/race-results.dto';
import type { RaceResultPreview } from '../modules/scoring-families/finish-position/race-result-service';

export function mapRaceResultPreviewToDto(preview: RaceResultPreview): RaceResultPreviewResponse {
  const { rows } = preview;
  return {
    rows: rows.map((row) => ({
      row: row.row,
      resolution: row.resolution,
      sportEventParticipantId: row.sportEventParticipantId,
      participantName: row.participantName,
      rowError: row.rowError,
      change: row.change,
      before: row.before,
      after: row.after,
    })),
    orderErrors: preview.orderErrors,
    rollup: {
      total: rows.length,
      matched: rows.filter((row) => row.resolution === 'MATCHED').length,
      unresolved: rows.filter((row) => row.resolution === 'UNRESOLVED').length,
      ambiguous: rows.filter((row) => row.resolution === 'AMBIGUOUS').length,
      invalid: rows.filter((row) => row.rowError !== null).length,
    },
  };
}
