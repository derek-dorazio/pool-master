import { enumLabel } from '@poolmaster/shared/display-strings';
import {
  PickEmMode,
  SelectionType,
  formatContestRules,
  formatEntriesPerTeam,
  formatEntriesPerTeamSentence,
  formatPickEmRulesName,
  formatSelectionTypeName,
  formatSpread,
  suggestContestName,
  type ContestRules,
  type SportNoun,
} from '@poolmaster/shared/domain';

// Contest rules in words (#845): the one place web and email take their sentences from, so each
// selection type's sentence and suggested name is pinned here, edge by edge.

const golfer: SportNoun = { one: 'golfer', many: 'golfers' };
const rules = (value: Record<string, unknown>) => value as unknown as ContestRules;
const tiered = (picksPerTier: number, countedScores: number) =>
  rules({ selectionType: SelectionType.TIERED, picksPerTier, countedScores });

describe('formatContestRules — tiered', () => {
  it('reads an event with no tiers yet by its tiers', () => {
    expect(formatContestRules(tiered(1, 4), 0, golfer)).toBe('Pick 1 golfer from each of the event\'s tiers. The best 4 scores count.');
  });

  it('names every tier of the event, and the one tier of a one-tier event', () => {
    expect(formatContestRules(tiered(3, 2), 1, golfer)).toBe('Pick 3 golfers from the event\'s one tier. The best 2 scores count.');
    expect(formatContestRules(tiered(1, 4), 6, golfer)).toBe('Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
  });
});

describe('formatContestRules — the other selection types', () => {
  it('names the salary cap of a budget contest when the event has one, and the salary cap alone when not', () => {
    const budget = rules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 });

    expect(formatContestRules(budget, 0, golfer, 50_000)).toBe('Pick 6 golfers whose prices fit under the $50,000 salary cap. The best 4 scores count.');
    expect(formatContestRules(budget, 0, golfer)).toBe('Pick 6 golfers whose prices fit under the salary cap. The best 4 scores count.');
  });

  it('deals a sweepstakes entry its participants at random', () => {
    const draw = rules({ selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 3, countedScores: 3 });
    expect(formatContestRules(draw, 0, golfer)).toBe('The draw deals each entry 3 golfers at random. Every score counts.');
  });

  it('reads pick\'em against the spread straight up and by confidence, and a confidence pool without the spread', () => {
    const pickEm = (mode: PickEmMode, againstTheSpread: boolean) => formatContestRules(rules({ selectionType: SelectionType.PICK_EM, mode, againstTheSpread }), 0, golfer);

    expect(pickEm(PickEmMode.STRAIGHT_UP, true)).toBe('Pick the team that covers the spread in every game. A game that lands exactly on the spread scores nothing.');
    expect(pickEm(PickEmMode.CONFIDENCE, true)).toBe('Pick the team that covers the spread in every game, then rank each week’s picks by confidence. A game that lands exactly on the spread scores nothing.');
    expect(pickEm(PickEmMode.CONFIDENCE, false)).toBe('Pick the winner of every game, then rank each week’s picks by confidence.');
  });

  it('reads a bracket as the whole bracket filled in before the first game', () => {
    expect(formatContestRules(rules({ selectionType: SelectionType.BRACKET }), 0, golfer)).toBe('Fill in the whole bracket before the first game: pick the winner of every game, all the way to the final.');
  });

  it('reads survivor team reuse as on unless the contest turns it off, and a squares limit in boxes', () => {
    const survivor = (reuseTeamsOnceAllUsed: boolean | undefined) => formatContestRules(rules({ selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed }), 0, golfer);

    expect(survivor(undefined)).toContain('never the same team twice until every team has been picked');
    expect(survivor(false)).toContain('Pick one team to win each week, and never the same team twice. A loss');
    expect(survivor(undefined)).not.toContain('lose once');
    expect(formatContestRules(rules({ selectionType: SelectionType.SURVIVOR, lives: 2 }), 0, golfer)).toContain('You can lose once and stay in; a second loss puts you out.');
    expect(formatContestRules(rules({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 1 }), 0, golfer)).toMatch(/^Claim up to 1 box on a 10x10 grid/);
  });

  it('says a squares contest\'s numbers are drawn when the grid fills or 5 minutes before kickoff', () => {
    expect(formatContestRules(rules({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 }), 0, golfer))
      .toContain('The numbers are drawn when the grid fills or 5 minutes before kickoff');
  });
});

describe('suggestContestName', () => {
  it('suggests a name for each selection type from the event and the rules, falling back to the type when the rules are not its own', () => {
    const name = (selectionType: SelectionType, configuration: ContestRules | null, tierCount = 0) =>
      suggestContestName('The Masters', selectionType, configuration, tierCount);

    expect(name(SelectionType.TIERED, tiered(1, 4), 6)).toBe('The Masters Pick 6');
    expect(name(SelectionType.TIERED, tiered(1, 4), 0)).toBe('The Masters Tiered');
    expect(name(SelectionType.BUDGET_PICK, rules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6 }))).toBe('The Masters Budget Pick 6');
    expect(name(SelectionType.BUDGET_PICK, null)).toBe('The Masters Budget');
    expect(name(SelectionType.RANDOM_DRAW, null)).toBe('The Masters Sweepstake');
    expect(name(SelectionType.PICK_EM, null)).toBe('The Masters Pick’em');
    expect(name(SelectionType.BRACKET, rules({ selectionType: SelectionType.BRACKET }))).toBe('The Masters Bracket');
    expect(name(SelectionType.BRACKET, null)).toBe('The Masters Bracket');
    expect(name(SelectionType.SURVIVOR, null)).toBe('The Masters Survivor');
    expect(name(SelectionType.SQUARES, null)).toBe('The Masters Squares');
  });
});

describe('contest rules labels', () => {
  it('formats the type, pick\'em rules, bracket start, entry limits and spreads as their choices read', () => {
    expect(formatSelectionTypeName(SelectionType.RANDOM_DRAW)).toBe(enumLabel('SelectionType', SelectionType.RANDOM_DRAW));
    expect(formatPickEmRulesName({ mode: PickEmMode.CONFIDENCE, againstTheSpread: true })).toBe('Confidence, against the spread');
    expect(formatPickEmRulesName({ mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false })).toBe('Straight up');
    expect([formatEntriesPerTeam(null), formatEntriesPerTeam(3)]).toEqual(['No limit', '3']);
    expect([formatEntriesPerTeamSentence(undefined), formatEntriesPerTeamSentence(1), formatEntriesPerTeamSentence(3)])
      .toEqual(['No limit on entries per member', '1 entry per member', '3 entries per member']);
    expect([formatSpread(0), formatSpread(7), formatSpread(-3.5)]).toEqual(['PK', '+7', '-3.5']);
  });
});
