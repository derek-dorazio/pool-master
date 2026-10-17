/**
 * Head to head's leaderboard (#698): nothing yet after the total. A contest on a bracket event
 * cannot be set up until knockout scoring arrives (#699), which adds each pick's wins, upset bonus
 * and whether it is still alive; until then a pick has no score.
 */

import type { ScoringFamilyUi } from './types';

export const headToHeadUi: ScoringFamilyUi = {
  // The tiebreaker (one total-points prediction) arrives with knockout scoring.
  entryTiebreaker: null,
  leaderboard() {
    return {
      detailColumns: [],
      footnote: null,
      pickDetail() {
        return { total: null, detailCells: [] };
      },
    };
  },
};
