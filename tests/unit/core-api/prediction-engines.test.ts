/**
 * The prediction engines: pick'em (#716) — which confidence values one pick may carry, and what
 * stops a week of picks being submitted, in a straight-up and a confidence pool — and bracket
 * (#721), whose later games offer the entry's own picked winners and which needs a tiebreaker.
 */
import { expect } from '@jest/globals';
import { MatchSide, PickEmMode, PickOutcome, PredictedResult, SelectionType, UpsetBonusRule, type ContestScoringSettings } from '@poolmaster/shared/domain';
import { PickWindow } from '../../../packages/core-api/src/modules/contests/entry-window';
import { bracketPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/bracket';
import { pickEmPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/pick-em';
import { survivorPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/survivor';
import { PredictionIssueKind } from '../../../packages/core-api/src/modules/selections/prediction-engines/prediction-engine';
import { getPredictionEngine } from '../../../packages/core-api/src/modules/selections/prediction-engines/registry';
import { expectDefined } from '../../support/expect-defined';
import { EIGHT_SEEDS, bracketPick, eightTeamBracket, withResults } from '../../support/bracket-fixtures';

const STRAIGHT_UP = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false };
const CONFIDENCE = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false };
const GAMES = ['game-1', 'game-2', 'game-3'];

function picks(...confidences: Array<number | null>) {
  return confidences.map((confidence, index) => ({ sportEventMatchId: `game-${index + 1}`, predictedResult: PredictedResult.TEAM, sportEventParticipantId: `home-${index + 1}`, confidence }));
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
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, null, null), tiebreakerValue: 40,
    })).toEqual([]);
  });

  it('finds nothing in a confidence week whose values are 1 to the game count, each once', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(2, 3, 1), tiebreakerValue: 40,
    })).toEqual([]);
  });

  it('reports an incomplete week with how many of its games are picked', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, null), tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 }]);
  });

  it('does not count a pick on a game outside the week toward completing it', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP,
      gameMatchIds: GAMES,
      predictions: [...picks(null, null), { sportEventMatchId: 'cancelled-game', predictedResult: PredictedResult.TEAM, sportEventParticipantId: 'home-9', confidence: null }],
      tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 }]);
  });

  it('reports invalid confidence when a confidence pick has no value', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, null, 3), tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a value is above the game count', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, 2, 4), tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a value is used twice', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(1, 3, 3), tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports invalid confidence when a straight-up pick carries a value', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, 2, null), tiebreakerValue: 40,
    })).toEqual([{ kind: PredictionIssueKind.CONFIDENCE_INVALID }]);
  });

  it('reports both an incomplete week and a repeated value together', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: CONFIDENCE, gameMatchIds: GAMES, predictions: picks(2, 2), tiebreakerValue: 40,
    })).toEqual([
      { kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 2, gameCount: 3 },
      { kind: PredictionIssueKind.CONFIDENCE_INVALID },
    ]);
  });

  it('reports a missing tiebreaker on a week otherwise ready to submit', () => {
    expect(pickEmPredictionEngine.findWeekIssues({
      configuration: STRAIGHT_UP, gameMatchIds: GAMES, predictions: picks(null, null, null), tiebreakerValue: null,
    })).toEqual([{ kind: PredictionIssueKind.TIEBREAKER_MISSING }]);
  });
});

describe('pick\'em engine — resolvePicks, scorePicks and the tiebreaker', () => {
  const games = eightTeamBracket().filter((game) => game.roundNumber === 1);

  it('offers each game its own two teams and keeps only the picks naming one of them', () => {
    const resolved = pickEmPredictionEngine.resolvePicks({
      games,
      predictions: [{ ...bracketPick(1, 'T8'), confidence: null }, { ...bracketPick(2, 'T1'), confidence: null }],
      seedOf: EIGHT_SEEDS,
    });

    expect(resolved.sides.get('m1')).toEqual({ home: 'T1', away: 'T8' });
    expect(resolved.kept.map((each) => each.sportEventMatchId)).toEqual(['m1']);
    expect(resolved.stranded.map((each) => each.sportEventMatchId)).toEqual(['m2']);
  });

  it('scores a week by its pool\'s mode, and cannot score one whose rules are not pick\'em rules', () => {
    expect(pickEmPredictionEngine.scorePicks({ configuration: STRAIGHT_UP, games, predictions: [], seedOf: EIGHT_SEEDS, scoring: null }))
      .toMatchObject({ points: 0, maxPossiblePoints: 0 });
    expect(pickEmPredictionEngine.scorePicks({ configuration: undefined, games, predictions: [], seedOf: EIGHT_SEEDS, scoring: null })).toBeNull();
  });

  it('takes the week\'s last game by kickoff as its tiebreaker game', () => {
    const start = new Date('2026-09-10T20:00:00.000Z');
    const [first, second] = games;
    const late = { ...expectDefined(first), scheduledDate: new Date('2026-09-14T00:15:00.000Z') };
    const early = { ...expectDefined(second), scheduledDate: null };
    expect(pickEmPredictionEngine.tiebreakerGame({ games: [late, early], eventStart: start })?.id).toBe(late.id);
  });
});

describe('bracket engine', () => {
  const KNOCKOUT: ContestScoringSettings = {
    participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
    config: { roundValues: [1, 2, 4], upsetBonus: { rule: UpsetBonusRule.NONE } },
  };
  const GAME_IDS = eightTeamBracket().map((game) => game.id);
  const fullBracket = [
    bracketPick(1, 'T1'), bracketPick(2, 'T4'), bracketPick(3, 'T2'), bracketPick(4, 'T3'),
    bracketPick(5, 'T1'), bracketPick(6, 'T2'), bracketPick(7, 'T1'),
  ].map((each) => ({ ...each, confidence: null }));

  it('serves BRACKET from the registry, locking every pick at the event\'s start, with the final as its tiebreaker game', () => {
    expect(getPredictionEngine(SelectionType.BRACKET)).toBe(bracketPredictionEngine);
    expect(bracketPredictionEngine.pickWindow).toBe(PickWindow.UNTIL_EVENT_START);
    expect(bracketPredictionEngine.tiebreakerGame({ games: eightTeamBracket(), eventStart: new Date() })?.id).toBe(GAME_IDS.at(-1));
  });

  it('accepts a pick only without a confidence value', () => {
    expect(bracketPredictionEngine.acceptsConfidence({ configuration: undefined, confidence: null, gameCount: 7 })).toBe(true);
    expect(bracketPredictionEngine.acceptsConfidence({ configuration: undefined, confidence: 1, gameCount: 7 })).toBe(false);
  });

  it('offers a later game the entry\'s picked winners and strands a pick that no longer follows from them', () => {
    const resolved = bracketPredictionEngine.resolvePicks({
      games: eightTeamBracket(),
      predictions: fullBracket.map((each) => (each.sportEventMatchId === 'm1' ? { ...each, sportEventParticipantId: 'T8' } : each)),
      seedOf: EIGHT_SEEDS,
    });

    expect(resolved.sides.get('m5')).toEqual({ home: 'T8', away: 'T4' });
    expect(resolved.stranded.map((each) => each.sportEventMatchId)).toEqual(['m5', 'm7']);
  });

  it('scores the picks with the contest\'s knockout round values', () => {
    const played = withResults(eightTeamBracket(), new Map([[1, { winner: MatchSide.HOME }], [2, { winner: MatchSide.AWAY }]]));
    const score = expectDefined(bracketPredictionEngine.scorePicks({ configuration: undefined, games: played, predictions: fullBracket, seedOf: EIGHT_SEEDS, scoring: KNOCKOUT }));

    expect(score.picks.get('m1')).toEqual({ outcome: PickOutcome.CORRECT, points: 1 });
    expect(score.picks.get('m2')).toEqual({ outcome: PickOutcome.BUSTED, points: 0 });
    expect(score.points).toBe(1);
    expect(score.maxPossiblePoints).toBe(1 + 1 + 1 + 2 + 2 + 4);
  });

  it('scores nothing when the contest has no knockout round-points scoring', () => {
    expect(bracketPredictionEngine.scorePicks({ configuration: undefined, games: eightTeamBracket(), predictions: fullBracket, seedOf: EIGHT_SEEDS, scoring: null })).toBeNull();
    expect(bracketPredictionEngine.scorePicks({
      configuration: undefined,
      games: eightTeamBracket(),
      predictions: fullBracket,
      seedOf: EIGHT_SEEDS,
      scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
    })).toBeNull();
  });

  it('finds nothing in a bracket with every game picked and a tiebreaker given', () => {
    expect(bracketPredictionEngine.findWeekIssues({ configuration: undefined, gameMatchIds: GAME_IDS, predictions: fullBracket, tiebreakerValue: 140 })).toEqual([]);
  });

  it('reports a bracket with a game unpicked and no tiebreaker as incomplete and missing its tiebreaker', () => {
    expect(bracketPredictionEngine.findWeekIssues({
      configuration: undefined, gameMatchIds: GAME_IDS, predictions: fullBracket.slice(0, 6), tiebreakerValue: null,
    })).toEqual([
      { kind: PredictionIssueKind.WEEK_INCOMPLETE, pickedCount: 6, gameCount: 7 },
      { kind: PredictionIssueKind.TIEBREAKER_MISSING },
    ]);
  });

  it('reports only the missing tiebreaker on a fully picked bracket', () => {
    expect(bracketPredictionEngine.findWeekIssues({ configuration: undefined, gameMatchIds: GAME_IDS, predictions: fullBracket, tiebreakerValue: null }))
      .toEqual([{ kind: PredictionIssueKind.TIEBREAKER_MISSING }]);
  });
});

describe('tie picks in each engine (#792)', () => {
  const games = eightTeamBracket().filter((game) => game.roundNumber === 1);
  const tie = (matchNumber: number) => ({ sportEventMatchId: `m${matchNumber}`, predictedResult: PredictedResult.TIE, sportEventParticipantId: null, confidence: null });
  const team = (matchNumber: number, row: string) => ({ ...bracketPick(matchNumber, row), confidence: null });

  it('takes tie picks only in pick\'em: a bracket and a survivor pick always name a team', () => {
    expect([pickEmPredictionEngine, bracketPredictionEngine, survivorPredictionEngine].map((engine) => [engine.selectionType, engine.takesTiePicks])).toEqual([
      [SelectionType.PICK_EM, true],
      [SelectionType.BRACKET, false],
      [SelectionType.SURVIVOR, false],
    ]);
  });

  it('keeps a pick\'em tie pick on a game of the week and strands one on a game the week does not have', () => {
    const resolved = pickEmPredictionEngine.resolvePicks({ games, predictions: [tie(1), team(2, 'T4'), tie(99)], seedOf: EIGHT_SEEDS });

    expect(resolved.kept.map((each) => each.sportEventMatchId)).toEqual(['m1', 'm2']);
    expect(resolved.stranded.map((each) => each.sportEventMatchId)).toEqual(['m99']);
  });

  it('strands a tie pick in a bracket, keeping the team picks around it', () => {
    const resolved = bracketPredictionEngine.resolvePicks({ games: eightTeamBracket(), predictions: [team(1, 'T1'), tie(2)], seedOf: EIGHT_SEEDS });

    expect(resolved.kept.map((each) => each.sportEventMatchId)).toEqual(['m1']);
    expect(resolved.stranded.map((each) => each.sportEventMatchId)).toEqual(['m2']);
  });

  it('strands a tie pick in a survivor week, so the week holds no pick', () => {
    const resolved = survivorPredictionEngine.resolvePicks({ games, predictions: [tie(1)], seedOf: EIGHT_SEEDS });

    expect(resolved.kept).toEqual([]);
    expect(resolved.stranded.map((each) => each.sportEventMatchId)).toEqual(['m1']);
  });
});
