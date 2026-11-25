import { describe, expect, it } from 'vitest';
import type { SportLeaguePhaseDefinitionDto } from '@/lib/api';
import { competitionCodesText, mappingText, periodsText, phaseSlotCount, positionCodeText, seriesText, slotRowsOf } from './league-structure-rows';

// The Structure tab's words for a slot (#2002): its name, series and provider mappings.

describe('league structure rows', () => {
  it('says a single game alone, and a series or legs with their games', () => {
    expect(seriesText({ seriesFormat: 'SINGLE_GAME', seriesGames: 1 })).toBe('Single game');
    expect(seriesText({ seriesFormat: 'AGGREGATE', seriesGames: 2 })).toBe('Aggregate · 2 games');
  });

  it('writes a mapping as its provider and league, how it matches, and its value when it has one', () => {
    const mapping = {
      id: 'm', providerId: 'p', providerName: 'BALLDONTLIE', providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR', matchType: 'NAME_PATTERN', providerValue: 'masters tournament',
    } as const;
    expect(mappingText(mapping)).toBe('BALLDONTLIE pga · Name pattern masters tournament');
  });

  it('writes a position\'s provider code as its provider and league, then the code the feed sends', () => {
    expect(positionCodeText({ provider: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerLeagueName: 'NFL', providerCode: 'QB' })).toBe('BALLDONTLIE nfl · QB');
  });

  it('says what a game is played in with how many, and that a game kept by no period has none', () => {
    expect(periodsText({ periodUnit: 'QUARTER', periodCount: 4 })).toBe('Quarters · 4');
    expect(periodsText({ periodUnit: null, periodCount: null })).toBe('No periods');
    expect(periodsText({ periodUnit: 'QUARTER', periodCount: null })).toBe('No periods');
  });

  it('flattens phases and their competitions into slot rows that carry their phase and competition code, in the order given', () => {
    const final: SportLeaguePhaseDefinitionDto['competitions'][number]['slots'][number] = {
      id: 's', key: 'FINAL', slotKind: 'FINAL', weekNumber: null, name: null, awardsTrophy: true, squaresEligible: true,
      seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
      matchFormat: 'HEAD_TO_HEAD', canEndTied: false, periodUnit: 'QUARTER', periodCount: 4, providerMappings: [],
    };
    const phases: SportLeaguePhaseDefinitionDto[] = [
      { id: 'a', phase: 'REGULAR', isSynced: true, competitions: [{ id: 'ca', code: 'REGULAR', orderIndex: 1, slots: [] }] },
      {
        id: 'b', phase: 'POSTSEASON', isSynced: true, competitions: [
          { id: 'cb', code: 'BOWLS', orderIndex: 1, slots: [{ ...final, id: 'bowl', key: 'BOWL' }] },
          { id: 'cc', code: 'CFP', orderIndex: 2, slots: [final] },
        ],
      },
    ];
    expect(slotRowsOf(phases).map((row) => [row.phase, row.competitionCode, row.key])).toEqual([['POSTSEASON', 'BOWLS', 'BOWL'], ['POSTSEASON', 'CFP', 'FINAL']]);
    expect(phases.map((phase) => [competitionCodesText(phase), phaseSlotCount(phase)])).toEqual([['REGULAR', 0], ['BOWLS, CFP', 2]]);
  });
});
