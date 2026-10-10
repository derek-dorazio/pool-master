import { SelectionType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  formatContestRules,
  formatEntriesPerTeam,
  formatEntriesPerTeamSentence,
  formatPresetLabel,
  formatSelectionTypeName,
  suggestContestName,
} from './contest-rules';
import { parseContestRules } from './contest-rules-form';

describe('contest rules sentence', () => {
  it('names every selection type in plain words, so a new type without a name fails', () => {
    for (const selectionType of Object.values(SelectionType)) {
      expect(formatSelectionTypeName(selectionType)).not.toMatch(/_|^[A-Z]+$/);
    }
    expect(formatSelectionTypeName(SelectionType.TIERED)).toBe('Tiered');
  });

  it('reads a tiered contest as picks per tier across the event\'s tiers and the best scores that count', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 6))
      .toBe('Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 2, countedScores: 1 }, 6))
      .toBe('Pick 2 golfers from each of 6 tiers. The best score counts.');
  });

  it('says every score counts when the counted scores cover the whole roster', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 6 }, 6))
      .toBe('Pick 1 golfer from each of 6 tiers. Every score counts.');
  });

  it('still reads sensibly before the event has tiers', () => {
    expect(formatContestRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, 0))
      .toBe("Pick 1 golfer from each of the event's tiers. The best 4 scores count.");
  });

  it('reads a budget contest as a roster under the salary cap and the best scores that count', () => {
    expect(formatContestRules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 }, 6))
      .toBe('Pick 6 golfers whose prices fit under the salary cap. The best 4 scores count.');
    expect(formatContestRules({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 6 }, 0))
      .toBe('Pick 6 golfers whose prices fit under the salary cap. Every score counts.');
  });

  it('shows an unlimited entry allowance as No limit', () => {
    expect(formatEntriesPerTeam(null)).toBe('No limit');
    expect(formatEntriesPerTeam(undefined)).toBe('No limit');
    expect(formatEntriesPerTeam(3)).toBe('3');
  });
});

describe('contest rules form', () => {
  const valid = { picksPerTier: '1', countedScores: '4', maxEntriesPerTeam: '2', unlimitedEntries: false };

  it('turns valid fields into the configuration the API takes', () => {
    expect(parseContestRules(valid, 6)).toEqual({
      configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 2 },
      error: null,
    });
  });

  it('sends no entry limit when No limit is ticked', () => {
    expect(parseContestRules({ ...valid, unlimitedEntries: true, maxEntriesPerTeam: '' }, 6).configuration)
      .toEqual({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });
  });

  it('refuses more scores that count than golfers picked, naming the roster size', () => {
    expect(parseContestRules({ ...valid, countedScores: '7' }, 6).error)
      .toBe('Scores that count must be between 1 and the 6 golfers picked.');
  });

  it('refuses a picks-per-tier or entry limit that is not a positive whole number', () => {
    expect(parseContestRules({ ...valid, picksPerTier: '0' }, 6).error).toBe('Picks per tier must be a positive whole number.');
    expect(parseContestRules({ ...valid, maxEntriesPerTeam: '1.5' }, 6).error).toBe('Entries per team must be a positive whole number.');
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

  it('says entries per team as a phrase a member reads', () => {
    expect(formatEntriesPerTeamSentence(1)).toBe('1 entry per team');
    expect(formatEntriesPerTeamSentence(3)).toBe('3 entries per team');
    expect(formatEntriesPerTeamSentence(null)).toBe('No limit on entries per team');
  });
});
