/**
 * Golf score mapper (#236) — a golf score upload's dry run → its response, with the
 * per-resolution rollup the upload screen shows.
 */

import type { GolfRoundScorePreviewResponse } from '@poolmaster/shared/dto/golf-scores.dto';
import type { GolfScorePreviewRow } from '../modules/golf/golf-score-service';

export function mapGolfRoundScorePreviewToDto(rows: GolfScorePreviewRow[]): GolfRoundScorePreviewResponse {
  return {
    rows: rows.map((row) => ({
      row: row.row,
      resolution: row.resolution,
      sportEventParticipantId: row.sportEventParticipantId,
      participantName: row.participantName,
      change: row.change,
      before: row.before,
      after: row.after,
    })),
    rollup: {
      total: rows.length,
      matched: rows.filter((row) => row.resolution === 'MATCHED').length,
      unresolved: rows.filter((row) => row.resolution === 'UNRESOLVED').length,
      ambiguous: rows.filter((row) => row.resolution === 'AMBIGUOUS').length,
    },
  };
}
