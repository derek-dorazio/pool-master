import { PickEmMode, SelectionType, Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  formatContestRules,
  formatEntriesPerTeam,
  formatEntriesPerTeamSentence,
  formatPresetLabel,
  formatSelectionTypeName,
  suggestContestName,
} from './contest-rules';
import { DEFAULT_CONTEST_RULES, parseContestRules, toContestRulesValues } from './contest-rules-form';

const GOLFER = getSportDefinition(Sport.GOLF).vocabulary.participant;
const HORSE = getSportDefinition(Sport.HORSE_RACING).vocabulary.participant;

describe('contest rules sentence', () => {
  it('names the picks in the event sport\'s words, so a horse racing contest reads horses, not golfers', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 3 }, 3, HORSE))
      .toBe('Pick 1 horse from each of 3 tiers. Every score counts.');
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

  it('names pick\'em and its two modes in product words', () => {
    expect(formatSelectionTypeName(SelectionType.PICK_EM)).toBe('Pick’em');
    expect(formatPresetLabel({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP }, 0)).toBe('Straight up');
    expect(formatPresetLabel({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE }, 0)).toBe('Confidence');
  });

  it('reads a straight-up contest as picking every game\'s winner, and a confidence one as also ranking each week\'s picks', () => {
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP }, 0, TEAM))
      .toBe('Pick the winner of every game.');
    expect(formatContestRules({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE }, 0, TEAM))
      .toBe('Pick the winner of every game, then rank each week’s picks by confidence.');
  });

  it('suggests a pick\'em name from the event', () => {
    expect(suggestContestName('NFL Week 1', SelectionType.PICK_EM, null, 0)).toBe('NFL Week 1 Pick’em');
  });

  it('turns the mode field into pick\'em rules with no roster size or scores that count', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, pickEmMode: PickEmMode.CONFIDENCE }, SelectionType.PICK_EM, 0, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, maxEntriesPerSquad: 1 }, error: null });
  });

  it('fills only the mode and entry limit from saved pick\'em rules, keeping the roster fields as they were', () => {
    const current = { ...DEFAULT_CONTEST_RULES, countedScores: '5', rosterSize: '8' };
    expect(toContestRulesValues({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, maxEntriesPerSquad: 2 }, current))
      .toEqual({ ...current, pickEmMode: PickEmMode.CONFIDENCE, maxEntriesPerTeam: '2', unlimitedEntries: false });
  });
});

describe('bracket rules', () => {
  const TEAM = getSportDefinition(Sport.BASKETBALL).vocabulary.participant;

  it('names a bracket contest Bracket and reads its rules as every game picked to the final before the first game', () => {
    expect(formatSelectionTypeName(SelectionType.BRACKET)).toBe('Bracket');
    expect(formatPresetLabel({ selectionType: SelectionType.BRACKET }, 0)).toBe('Bracket');
    expect(formatContestRules({ selectionType: SelectionType.BRACKET }, 4, TEAM))
      .toBe('Fill in the whole bracket before the first game: pick the winner of every game, all the way to the final.');
  });

  it('suggests a bracket name from the event', () => {
    expect(suggestContestName('March Madness', SelectionType.BRACKET, null, 4)).toBe('March Madness Bracket');
  });

  it('turns the bracket fields into bracket rules carrying only the entry limit', () => {
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, maxEntriesPerTeam: '3' }, SelectionType.BRACKET, 4, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.BRACKET, maxEntriesPerSquad: 3 }, error: null });
    expect(parseContestRules({ ...DEFAULT_CONTEST_RULES, unlimitedEntries: true }, SelectionType.BRACKET, 4, TEAM))
      .toEqual({ configuration: { selectionType: SelectionType.BRACKET }, error: null });
  });

  it('fills only the entry limit from saved bracket rules, keeping every other format\'s fields', () => {
    const current = { ...DEFAULT_CONTEST_RULES, countedScores: '5', rosterSize: '8' };
    expect(toContestRulesValues({ selectionType: SelectionType.BRACKET, maxEntriesPerSquad: null }, current))
      .toEqual({ ...current, maxEntriesPerTeam: '1', unlimitedEntries: true });
  });
});

describe('Create contest wording', () => {
  it('labels a tiered preset by the golfers picked and the scores that count on the chosen event', () => {
    expect(formatPresetLabel({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 6)).toBe('Pick 6, best 4');
    expect(formatPresetLabel({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 6 }, 6)).toBe('Pick 6, all count');
    expect(formatPresetLabel({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 8 }, 0)).toBe('2 per tier, best 8');
  });

  it('labels a budget preset by its roster and the scores that count, whatever the event\'s tiers', () => {
    expect(formatPresetLabel({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 }, 0)).toBe('Pick 6, best 4');
    expect(formatPresetLabel({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 6 }, 6)).toBe('Pick 6, all count');
  });

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
