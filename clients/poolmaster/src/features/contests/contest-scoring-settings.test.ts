import { describe, expect, it } from 'vitest';
import { EMPTY_SCORING_SETTINGS_VALUES, SCORING_SETTINGS_UI } from './contest-scoring-settings';

// Create contest's knockout round points inputs (#699): what the form sends, what it refuses
// with the message it shows, and how a preset fills it.

const knockoutUi = SCORING_SETTINGS_UI.KNOCKOUT_ROUND_POINTS;

describe('knockout round points settings', () => {
  it('sends the round values with no upset bonus when the bonus is off', () => {
    expect(knockoutUi.parse({ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1, 2, 4, 8' })).toEqual({
      scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } } },
      error: null,
    });
  });

  it('sends the seed-difference bonus with its multiplier when the bonus is on', () => {
    expect(knockoutUi.parse({ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1 2', upsetBonusRule: 'SEED_DIFFERENCE', upsetBonusMultiplier: '2' }).scoring)
      .toEqual({ participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1, 2], upsetBonus: { rule: 'SEED_DIFFERENCE', multiplier: 2 } } });
  });

  it('refuses blank or non-whole round values, and a multiplier below 1, with the message the form shows', () => {
    expect(knockoutUi.parse({ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '' }).error)
      .toBe('Enter the points for a win in each round as whole numbers, first round first, such as 1, 2, 4, 8.');
    expect(knockoutUi.parse({ ...EMPTY_SCORING_SETTINGS_VALUES, roundValues: '1, 2', upsetBonusRule: 'SEED_DIFFERENCE', upsetBonusMultiplier: '0' }).error)
      .toBe('The upset bonus multiplier must be a whole number, 1 or more.');
  });

  it('fills the form from a preset and describes it for members', () => {
    const preset = { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS' as const, config: { roundValues: [1, 2, 4], upsetBonus: { rule: 'SEED_DIFFERENCE' as const, multiplier: 1 } } };

    expect(knockoutUi.toValues(preset, EMPTY_SCORING_SETTINGS_VALUES)).toMatchObject({ roundValues: '1, 2, 4', upsetBonusRule: 'SEED_DIFFERENCE', upsetBonusMultiplier: '1' });
    expect(knockoutUi.describe(preset)).toBe('Points for a win in each round: 1, 2, 4. A win over a better seed adds the seed difference.');
  });
});
