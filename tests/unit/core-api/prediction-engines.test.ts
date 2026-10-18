/**
 * The pick'em prediction engine (#716): which confidence values one pick may carry, and what
 * stops a week of picks being submitted, in a straight-up and a confidence pool.
 */
import { expect } from '@jest/globals';
import { PickEmMode, SelectionType } from '@poolmaster/shared/domain';
import { PickWindow } from '../../../packages/core-api/src/modules/contests/entry-window';
import { pickEmPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/pick-em';
import { PredictionIssueKind } from '../../../packages/core-api/src/modules/selections/prediction-engines/prediction-engine';
import { getPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/registry';

const STRAIGHT_UP = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP };
const CONFIDENCE = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE };
const GAMES = ['game-1', 'game-2', 'game-3'];

function picks(...confidences: Array<number | null>) {
  return confidences.map((confidence, index) => ({ sportEventMatchId: `game-${index + 1}`, confidence }));
}

describe('pick\'em engine — registry and pick window', () => {
  it('serves PICK_EM from the prediction registry, locking each pick at its own game\'s kickoff', () => {
    expect(getPredictionEngine(SelectionType.PICK_EM)).toBe(pickEmPredictionEngine);
    expect(pickEmPredictionEngine.pickWindow).toBe(PickWindow.UNTIL_MATCH_START);
  });
});

describe('pick\'em engine — acceptsConfidence', () => {
  it('accepts a pick with no confidence value in either mode', () => {
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: STRAIGHT_UP, confidence: null, gameCount: 3 })).toBe(true);
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: CONFIDENCE, confidence: null, gameCount: 3 })).toBe(true);
  });

  it('accepts a confidence value from 1 to the week\'s game count in a confidence pool', () => {
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: CONFIDENCE, confidence: 1, gameCount: 3 })).toBe(true);
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: CONFIDENCE, confidence: 3, gameCount: 3 })).toBe(true);
  });

  it.each([0, 4, -1, 1.5])('refuses confidence %p in a confidence pool of three games', (confidence) => {
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: CONFIDENCE, confidence, gameCount: 3 })).toBe(false);
  });

  it('refuses any confidence value in a straight-up pool', () => {
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: STRAIGHT_UP, confidence: 1, gameCount: 3 })).toBe(false);
  });

  it('refuses a confidence value when the contest has no pick\'em rules stored', () => {
    expect(pickEmPredictionEngine.acceptsConfidence({ configuration: undefined, confidence: 1, gameCount: 3 })).toBe(false);
  });
});

describe('pick\'em engine — findWeekIssues', () => {
  it('finds nothing in a straight-up week with every game picked and no values', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, null, null),
    })).toEqual([]);
  });

  it('finds nothing in a confidence week whose values are 1 to the game count, each once', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(2, 3, 1),
    })).toEqual([]);
  });

  it('reports an incomplete week with how many of its games are picked', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, null),
    })).toEqual([{ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 }]);
  });

  it('does not count a pick on a game outside the week toward completing it', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP,
      gameMatchIds: GAMES,
      predictions: [...picks(null, null), { sportEventMatchId: 'cancelled-game', confidence: null }],
    })).toEqual([{ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 }]);
  });

  it('reports invalid confidence when a confidence pick has no value', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, null, 3),
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a value is above the game count', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, 2, 4),
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a value is used twice', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, 3, 3),
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a straight-up pick carries a value', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, 2, null),
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports both an incomplete week and a repeated value together', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(2, 2),
    })).toEqual([
      { kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 },
      { kind: PredictionIssueKind.CONFIDENCE_INVALID },
    ]);
  });
});
