import { ScoringFamily } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { GolfRoundScoresPanel } from './golf-round-scores-panel';
import { RaceFinishingOrderPanel } from './race-finishing-order-panel';
import { SCORING_FAMILY_ADMIN_UI, getScoringFamilyAdminUi } from './scoring-family-admin';

describe('Scoring family admin registry (plans/racing-sports.md Q9.6)', () => {
  it('gives a stroke-play event round scores, named Scores', () => {
    const ui = getScoringFamilyAdminUi({ scoringFamily: ScoringFamily.STROKE_PLAY });

    expect(ui.ResultsPanel).toBe(GolfRoundScoresPanel);
    expect(ui.resultsLabel).toBe('Scores');
  });

  it('gives a finish-position event the finishing-order card, named Results', () => {
    const ui = getScoringFamilyAdminUi({ scoringFamily: ScoringFamily.FINISH_POSITION });

    expect(ui.ResultsPanel).toBe(RaceFinishingOrderPanel);
    expect(ui.resultsLabel).toBe('Results');
  });

  it('reaches an event\'s results through its sport league\'s scoring family, with an entry for every family', () => {
    for (const scoringFamily of Object.values(ScoringFamily)) {
      expect(getScoringFamilyAdminUi({ scoringFamily })).toBe(SCORING_FAMILY_ADMIN_UI[scoringFamily]);
    }
    expect(Object.keys(SCORING_FAMILY_ADMIN_UI).sort()).toEqual(Object.values(ScoringFamily).sort());
  });
});
