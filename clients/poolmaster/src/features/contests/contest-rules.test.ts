import { SelectionType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { formatContestRules, formatEntriesPerTeam, formatSelectionTypeName } from './contest-rules';
import { parseContestRules } from './contest-rules-form';

describe('contest rules sentence', () => {
  it('names every selection type in plain words, so a new type without a name fails', () => {
    for (const selectionType of Object.values(SelectionType)) {
      expect(formatSelectionTypeName(selectionType)).not.toMatch(/_|^[A-Z]+$/);
    }
    expect(formatSelectionTypeName(SelectionType.TIERED)).toBe('Tiered');
  });

  it('reads a tiered contest as picks per tier across the event\'s tiers and the best scores that count', () => {
    expect(formatContestRules(SelectionType.TIERED, { picksPerTier: 1, countedScores: 4 }, 6))
      .toBe('Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(formatContestRules(SelectionType.TIERED, { picksPerTier: 2, countedScores: 1 }, 6))
      .toBe('Pick 2 golfers from each of 6 tiers. The best score counts.');
  });

  it('says every score counts when the counted scores cover the whole roster', () => {
    expect(formatContestRules(SelectionType.TIERED, { picksPerTier: 1, countedScores: 6 }, 6))
      .toBe('Pick 1 golfer from each of 6 tiers. Every score counts.');
  });

  it('still reads sensibly before the event has tiers', () => {
    expect(formatContestRules(SelectionType.TIERED, { picksPerTier: 1, countedScores: 4 }, 0))
      .toBe("Pick 1 golfer from each of the event's tiers. The best 4 scores count.");
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
      configuration: { picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 2 },
      error: null,
    });
  });

  it('sends no entry limit when No limit is ticked', () => {
    expect(parseContestRules({ ...valid, unlimitedEntries: true, maxEntriesPerTeam: '' }, 6).configuration)
      .toEqual({ picksPerTier: 1, countedScores: 4 });
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
