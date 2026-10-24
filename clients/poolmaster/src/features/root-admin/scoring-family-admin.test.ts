import { SUPPORTED_SPORTS, ScoringFamily, Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { GolfRoundScoresPanel } from './golf-round-scores-panel';
import { RaceFinishingOrderPanel } from './race-finishing-order-panel';
import { StatLinesPanel } from './stat-lines-panel';
import { SCORING_FAMILY_ADMIN_UI, getScoringFamilyAdminUi } from './scoring-family-admin';

describe('Scoring family admin registry (plans/racing-sports.md Q9.6)', () => {
  it('gives a golf event round scores, named Scores, with par per round on its details', () => {
    const ui = getScoringFamilyAdminUi({ sport: Sport.GOLF });

    expect(ui.ResultsPanel).toBe(GolfRoundScoresPanel);
    expect(ui.resultsLabel).toBe('Scores');
    expect(ui.scoresUnplayedRoundsAgainstPar).toBe(true);
  });

  it('gives a horse race the finishing-order card, named Results, with no par to set', () => {
    const ui = getScoringFamilyAdminUi({ sport: Sport.HORSE_RACING });

    expect(ui.ResultsPanel).toBe(RaceFinishingOrderPanel);
    expect(ui.resultsLabel).toBe('Results');
    expect(ui.scoresUnplayedRoundsAgainstPar).toBe(false);
  });

  it('gives a stat pool event of a team sport the stat grid, named Stats, where its sport\'s own events keep the bracket', () => {
    const ui = getScoringFamilyAdminUi({ sport: Sport.BASEBALL, participantType: 'INDIVIDUAL', scoringFamily: ScoringFamily.COMPOSITE });

    expect(ui.ResultsPanel).toBe(StatLinesPanel);
    expect(ui.resultsLabel).toBe('Stats');
    expect(getScoringFamilyAdminUi({ sport: Sport.BASEBALL, participantType: null, scoringFamily: null }).resultsLabel).toBe('Bracket');
  });

  it('reaches every supported sport\'s results through its scoring family, never by sport', () => {
    for (const sport of SUPPORTED_SPORTS) {
      expect(getScoringFamilyAdminUi({ sport })).toBe(SCORING_FAMILY_ADMIN_UI[getSportDefinition(sport).scoringFamily]);
    }
    expect(Object.keys(SCORING_FAMILY_ADMIN_UI).sort()).toEqual(Object.values(ScoringFamily).sort());
  });
});
