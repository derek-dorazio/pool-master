import { PickEmMode, SelectionType, Sport, getSportDefinition,
  describeSurvivorRules,
  formatBracketStartLabel,
  formatContestRules,
  formatEntriesPerTeam,
  formatEntriesPerTeamSentence,
  formatSelectionTypeName,
  suggestContestName } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEST_RULES, parseContestRules, toContestRulesValues } from './contest-rules-form';

const GOLFER = getSportDefinition(Sport.GOLF).vocabulary.participant;
const HORSE = getSportDefinition(Sport.HORSE_RACING).vocabulary.participant;

describe('contest rules sentence', () => {
  it('names the picks in the event sport\'s words, so a horse racing contest reads horses, not golfers', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 3 }, 3, HORSE))
      .toBe('Pick 1 horse from each of 3 tiers. Every score counts.');
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, tiersUsed: 4 }, 6, HORSE))
      .toBe('Pick 1 horse from each of the first 4 of 6 tiers. Every score counts.');
    expect(formatContestRules({ selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 2, countedScores: 1 }, 3, HORSE))
      .toBe('The draw deals each entry 2 horses at random. The best score counts.');
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, rosterSize: '13' }, SelectionType.BUDGET_PICK, 0, HORSE).error)
      .toMatch(/^Horses per entry must be between 1 and/);
  });

  it('names every selection type in plain words, so a new type without a name fails', () => {
    for (const selectionType of Object.values(SelectionType)) {
      expect(formatSelectionTypeName(selectionType)).not.toMatch(/_|^[A-Z]+$/);
    }
    expect(formatSelectionTypeName(SelectionType.TIERED)).toBe('Tiered');
  });

  it('reads a tiered contest as picks per tier across the event\'s tiers and the best scores that count', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 6, GOLFER))
      .toBe('Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 1 }, 6, GOLFER))
      .toBe('Pick 2 golfers from each of 6 tiers. The best score counts.');
  });

  it('says every score counts when the counted scores cover the whole roster', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 6 }, 6, GOLFER))
      .toBe('Pick 1 golfer from each of 6 tiers. Every score counts.');
  });

  it('still reads sensibly before the event has tiers', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 0, GOLFER))
      .toBe("Pick 1 golfer from each of the event's tiers. The best 4 scores count.");
  });

  it('reads a budget contest as a roster under the salary cap and the best scores that count', () => {
    expect(formatContestRules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 }, 6, GOLFER))
      .toBe('Pick 6 golfers whose prices fit under the salary cap. The best 4 scores count.');
    expect(formatContestRules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 6 }, 0, GOLFER))
      .toBe('Pick 6 golfers whose prices fit under the salary cap. Every score counts.');
  });

  it('names the event\'s salary cap in a budget sentence once it is known', () => {
    expect(formatContestRules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 }, 0, GOLFER, 50_000))
      .toBe('Pick 6 golfers whose prices fit under the $50,000 salary cap. The best 4 scores count.');
  });

  it('shows an unlimited entry allowance as No limit', () => {
    expect(formatEntriesPerTeam(null)).toBe('No limit');
    expect(formatEntriesPerTeam(undefined)).toBe('No limit');
    expect(formatEntriesPerTeam(3)).toBe('3');
  });
});

describe('contest rules form', () => {
  const valid = { ...DEFAULT_CONTEST_RULES, picksPerTier: '1', countedScores: '4', maxEntriesPerTeam: '2' };

  it('turns valid fields into the configuration the API takes', () => {
    expect(parseContestRules(valid, SelectionType.TIERED, 6, GOLFER)).toEqual({
      configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 2 },
      error: null,
    });
  });

  it('sends no entry limit when No limit is ticked', () => {
    expect(parseContestRules({ ...valid, unlimitedEntries: true, maxEntriesPerTeam: '' }, SelectionType.TIERED, 6, GOLFER).configuration)
      .toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });
  });

  it('refuses more scores that count than golfers picked, naming the roster size', () => {
    expect(parseContestRules({ ...valid, countedScores: '7' }, SelectionType.TIERED, 6, GOLFER).error)
      .toBe('Scores that count must be between 1 and the 6 golfers picked.');
  });

  it('refuses a picks-per-tier or entry limit that is not a positive whole number', () => {
    expect(parseContestRules({ ...valid, picksPerTier: '0' }, SelectionType.TIERED, 6, GOLFER).error).toBe('Picks per tier must be a positive whole number.');
    expect(parseContestRules({ ...valid, maxEntriesPerTeam: '1.5' }, SelectionType.TIERED, 6, GOLFER).error).toBe('Entries per member must be a positive whole number.');
  });

  it('sends the tiers to pick from when given, and counts the roster from those tiers alone', () => {
    expect(parseContestRules({ ...valid, tiersUsed: '4' }, SelectionType.TIERED, 6, GOLFER).configuration)
      .toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, tiersUsed: 4, maxEntriesPerSquad: 2 });
    expect(parseContestRules({ ...valid, tiersUsed: '4', countedScores: '5' }, SelectionType.TIERED, 6, GOLFER).error)
      .toBe('Scores that count must be between 1 and the 4 golfers picked.');
  });

  it('refuses more tiers to pick from than the event has, or a number that is not a whole one', () => {
    expect(parseContestRules({ ...valid, tiersUsed: '7' }, SelectionType.TIERED, 6, GOLFER).error)
      .toBe('Tiers to pick from must be between 1 and the event\'s 6, or left empty for every tier.');
    expect(parseContestRules({ ...valid, tiersUsed: '0' }, SelectionType.TIERED, 6, GOLFER).error)
      .toBe('Tiers to pick from must be between 1 and the event\'s 6, or left empty for every tier.');
  });

  it('fills the tiers to pick from from saved rules, and leaves it empty for rules that pick from every tier', () => {
    expect(toContestRulesValues({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, tiersUsed: 4, maxEntriesPerSquad: 1 }).tiersUsed).toBe('4');
    expect(toContestRulesValues({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 }).tiersUsed).toBe('');
  });

  it('turns budget fields into budget rules, leaving the salary cap to the event', () => {
    expect(parseContestRules({ ...valid, rosterSize: '6' }, SelectionType.BUDGET_PICK, 0, GOLFER)).toEqual({
      configuration: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4, maxEntriesPerSquad: 2 },
      error: null,
    });
  });

  it('refuses a budget roster outside 1 to 12 golfers, or more scores that count than it holds', () => {
    expect(parseContestRules({ ...valid, rosterSize: '13' }, SelectionType.BUDGET_PICK, 0, GOLFER).error)
      .toBe('Golfers per entry must be between 1 and 12.');
    expect(parseContestRules({ ...valid, rosterSize: '3' }, SelectionType.BUDGET_PICK, 0, GOLFER).error)
      .toBe('Scores that count must be between 1 and the 3 golfers picked.');
  });

  it('fills only the preset\'s own format fields, keeping what the other format holds', () => {
    const current = { ...valid, picksPerTier: '2', rosterSize: '8' };
    expect(toContestRulesValues({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 5, maxEntriesPerSquad: null }, current))
      .toEqual({ ...current, rosterSize: '6', countedScores: '5', unlimitedEntries: true, maxEntriesPerTeam: '1' });
  });
});

describe('pick\'em rules', () => {
  const TEAM = getSportDefinition(Sport.AMERICAN_FOOTBALL).vocabulary.participant;

  it('names pick\'em in product words', () => {
    expect(formatSelectionTypeName(SelectionType.PICK_EM)).toBe('Pick’em');
  });

  it('reads a straight-up contest as picking every game\'s winner, and a confidence one as also ranking each week\'s picks', () => {
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false }, 0, TEAM))
      .toBe('Pick the winner of every game.');
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false }, 0, TEAM))
      .toBe('Pick the winner of every game, then rank each week’s picks by confidence.');
  });

  it('reads a pool scored against the spread as picking the team that covers, with a game on the spread scoring nothing', () => {
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true }, 0, TEAM))
      .toBe('Pick the team that covers the spread in every game. A game that lands exactly on the spread scores nothing.');
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: true }, 0, TEAM))
      .toBe('Pick the team that covers the spread in every game, then rank each week’s picks by confidence. A game that lands exactly on the spread scores nothing.');
  });

  it('turns the against-the-spread box into the pick\'em rules and back', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, pickEmAgainstTheSpread: true }, SelectionType.PICK_EM, 0, TEAM).configuration)
      .toMatchObject({ selectionType: SelectionType.PICK_EM, againstTheSpread: true });
    expect(toContestRulesValues({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true, maxEntriesPerSquad: 1 }, DEFAULT_CONTEST_RULES))
      .toMatchObject({ pickEmAgainstTheSpread: true });
  });

  it('suggests a pick\'em name from the event', () => {
    expect(suggestContestName('NFL Week 1', SelectionType.PICK_EM, null, 0)).toBe('NFL Week 1 Pick’em');
  });

  it('turns the mode field into pick\'em rules with no roster size or scores that count', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, pickEmMode: PickEmMode.CONFIDENCE }, SelectionType.PICK_EM, 0, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false, maxEntriesPerSquad: 1 }, error: null });
  });

  it('fills only the mode and entry limit from saved pick\'em rules, keeping the roster fields as they were', () => {
    const current = { ...DEFAULT_CONTEST_RULES, countedScores: '5', rosterSize: '8' };
    expect(toContestRulesValues({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false, maxEntriesPerSquad: 2 }, current))
      .toEqual({ ...current, pickEmMode: PickEmMode.CONFIDENCE, maxEntriesPerTeam: '2', unlimitedEntries: false });
  });
});

describe('survivor rules', () => {
  const TEAM = getSportDefinition(Sport.AMERICAN_FOOTBALL).vocabulary.participant;

  it('names survivor and reads its rules as one winner a week, each team once until all are picked (unless set otherwise), out after a loss', () => {
    expect(formatSelectionTypeName(SelectionType.SURVIVOR)).toBe('Survivor');
    expect(formatContestRules({ selectionType: SelectionType.SURVIVOR }, 0, TEAM)).toBe(
      'Pick one team to win each week, and never the same team twice until every team has been picked. A loss, a tie or a week not submitted by its first kickoff puts the entry out; the last entries standing win.',
    );
    expect(formatContestRules({ selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false }, 0, TEAM)).toBe(
      'Pick one team to win each week, and never the same team twice. A loss, a tie or a week not submitted by its first kickoff puts the entry out; the last entries standing win.',
    );
    expect(describeSurvivorRules(null)).toBe(
      'Pick one team to win each week. A loss, a tie or a week not submitted by its first kickoff puts the entry out; the last entries standing win.',
    );
    expect(suggestContestName('NFL Week 1', SelectionType.SURVIVOR, null, 0)).toBe('NFL Week 1 Survivor');
  });

  it('turns the rules fields into survivor rules with the team reuse setting and entry limit, and fills both back', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, maxEntriesPerTeam: '2' }, SelectionType.SURVIVOR, 0, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: true, maxEntriesPerSquad: 2 }, error: null });
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, survivorReuseTeams: false }, SelectionType.SURVIVOR, 0, TEAM).configuration)
      .toEqual({ selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false, maxEntriesPerSquad: 1 });
    expect(toContestRulesValues({ selectionType: SelectionType.SURVIVOR, maxEntriesPerSquad: null }, { ...DEFAULT_CONTEST_RULES, survivorReuseTeams: false }))
      .toEqual({ ...DEFAULT_CONTEST_RULES, unlimitedEntries: true });
    expect(toContestRulesValues({ selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: false, maxEntriesPerSquad: 1 }, DEFAULT_CONTEST_RULES))
      .toEqual({ ...DEFAULT_CONTEST_RULES, survivorReuseTeams: false });
  });
});

describe('squares rules', () => {
  const TEAM = getSportDefinition(Sport.AMERICAN_FOOTBALL).vocabulary.participant;

  it('names squares and its suggested name, and reads its rules as boxes on a grid won by last digits', () => {
    expect(formatSelectionTypeName(SelectionType.SQUARES)).toBe('Squares');
    expect(suggestContestName('Super Bowl LXI', SelectionType.SQUARES, null, 0)).toBe('Super Bowl LXI Squares');
    expect(formatContestRules({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 }, 0, TEAM)).toBe(
      'Claim up to 10 boxes on a 10x10 grid. Once the numbers are drawn, the box matching the last digit of each team\'s score wins each quarter and the final score.',
    );
  });

  it('turns the rules fields into squares rules with the box limit, and refuses a limit past the grid', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, maxSquaresPerEntry: '5' }, SelectionType.SQUARES, 0, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 5, maxEntriesPerSquad: 1 }, error: null });
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, maxSquaresPerEntry: '101' }, SelectionType.SQUARES, 0, TEAM))
      .toEqual({ configuration: null, error: 'Boxes per entry must be between 1 and 100.' });
    expect(toContestRulesValues({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 4, maxEntriesPerSquad: 1 }, DEFAULT_CONTEST_RULES))
      .toEqual({ ...DEFAULT_CONTEST_RULES, maxSquaresPerEntry: '4' });
  });
});

describe('bracket rules', () => {
  const TEAM = getSportDefinition(Sport.BASKETBALL).vocabulary.participant;
  const MARCH_MADNESS_ROUND = (roundNumber: number) => getSportDefinition(Sport.BASKETBALL).roundLabel(roundNumber, 6);

  it('names a full bracket contest Bracket and reads its rules as every game picked to the final before the first game', () => {
    expect(formatSelectionTypeName(SelectionType.BRACKET)).toBe('Bracket');
    expect(formatContestRules({ selectionType: SelectionType.BRACKET, startsAtRound: 1 }, 4, TEAM, null, MARCH_MADNESS_ROUND))
      .toBe('Fill in the whole bracket before the first game: pick the winner of every game, all the way to the final.');
  });

  it('reads a bracket starting at round 3 of six as a second-chance bracket from the Sweet 16, closing at its first game', () => {
    expect(formatContestRules({ selectionType: SelectionType.BRACKET, startsAtRound: 3 }, 4, TEAM, null, MARCH_MADNESS_ROUND))
      .toBe('Second-chance bracket from the Sweet 16: pick the winner of every game from the Sweet 16 on, all the way to the final, before its first game.');
  });

  it('labels the starting-round choice Full bracket for round 1 and "From the" a later round\'s name', () => {
    expect(formatBracketStartLabel(1, MARCH_MADNESS_ROUND)).toBe('Full bracket');
    expect(formatBracketStartLabel(4, MARCH_MADNESS_ROUND)).toBe('From the Elite Eight');
  });

  it('suggests a bracket name from the event, and a second-chance bracket name for a later starting round', () => {
    expect(suggestContestName('March Madness', SelectionType.BRACKET, null, 4)).toBe('March Madness Bracket');
    expect(suggestContestName('March Madness', SelectionType.BRACKET, { selectionType: SelectionType.BRACKET, startsAtRound: 1 }, 4))
      .toBe('March Madness Bracket');
    expect(suggestContestName('March Madness', SelectionType.BRACKET, { selectionType: SelectionType.BRACKET, startsAtRound: 3 }, 4))
      .toBe('March Madness Second-Chance Bracket');
  });

  it('turns the bracket fields into bracket rules carrying the starting round and the entry limit, the full bracket by default', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, maxEntriesPerTeam: '3' }, SelectionType.BRACKET, 4, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.BRACKET, startsAtRound: 1, maxEntriesPerSquad: 3 }, error: null });
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, startsAtRound: '3', unlimitedEntries: true }, SelectionType.BRACKET, 4, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.BRACKET, startsAtRound: 3 }, error: null });
  });

  it('refuses a bracket starting round that is blank or past the most rounds a bracket can have', () => {
    for (const startsAtRound of ['', '0', '9', '2.5']) {
      expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, startsAtRound }, SelectionType.BRACKET, 4, TEAM))
        .toEqual({ configuration: null, error: 'Choose the round the bracket starts at.' });
    }
  });

  it('fills the starting round and the entry limit from saved bracket rules, keeping every other format\'s fields', () => {
    const current = { ...DEFAULT_CONTEST_RULES, countedScores: '5', rosterSize: '8' };
    expect(toContestRulesValues({ selectionType: SelectionType.BRACKET, startsAtRound: 3, maxEntriesPerSquad: null }, current))
      .toEqual({ ...current, maxEntriesPerTeam: '1', startsAtRound: '3', unlimitedEntries: true });
  });
});

describe('Create contest wording', () => {
  it('suggests a name from the event and the golfers picked, or the format before the event has tiers', () => {
    expect(suggestContestName('The Masters', SelectionType.TIERED, { selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 8 }, 6)).toBe('The Masters Pick 12');
    expect(suggestContestName('The Masters', SelectionType.TIERED, { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 0)).toBe('The Masters Tiered');
    expect(suggestContestName('The Masters', SelectionType.TIERED, null, 6)).toBe('The Masters Tiered');
  });

  it('suggests a budget name from the event and the roster size', () => {
    expect(suggestContestName('The Masters', SelectionType.BUDGET_PICK, { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 }, 0)).toBe('The Masters Budget Pick 6');
    expect(suggestContestName('The Masters', SelectionType.BUDGET_PICK, null, 0)).toBe('The Masters Budget');
  });

  it('says entries per member as a phrase a member reads', () => {
    expect(formatEntriesPerTeamSentence(1)).toBe('1 entry per member');
    expect(formatEntriesPerTeamSentence(3)).toBe('3 entries per member');
    expect(formatEntriesPerTeamSentence(null)).toBe('No limit on entries per member');
  });
});
