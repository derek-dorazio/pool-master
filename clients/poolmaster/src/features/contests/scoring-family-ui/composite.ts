/**
 * Composite's leaderboard (championship stat pools, #934): the entry total only, for now. The
 * game columns, each pick's composite total and its stats arrive with the stat pool screens
 * (#936), with the pick detail block that carries them.
 */

import type { ScoringFamilyUi } from './types';

export const compositeUi: ScoringFamilyUi = {
  // A composite total breaks no ties with a prediction: entries submit without one.
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
