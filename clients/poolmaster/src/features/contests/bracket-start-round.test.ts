import { Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { bracketRoundCount, bracketStartRoundOptions, hasSecondChanceRound, secondChanceRoundName } from './bracket-start-round';
import { buildSportEvent } from './test/contest-admin-fixtures';

const MARCH_MADNESS_ROUND = (roundNumber: number) => getSportDefinition(Sport.BASKETBALL).roundLabel(roundNumber, 6);

describe('where a bracket can start', () => {
  it('offers an event that has not started only the full bracket, since a later round has no teams to start from yet', () => {
    expect(bracketStartRoundOptions(6, MARCH_MADNESS_ROUND, { isUnderWay: false })).toEqual([
      { roundNumber: 1, name: 'First Round', label: 'Full bracket' },
    ]);
  });

  it('offers no full bracket on an event under way, only each later round up to the one before the final as a second-chance bracket', () => {
    expect(bracketStartRoundOptions(6, MARCH_MADNESS_ROUND, { isUnderWay: true })).toEqual([
      { roundNumber: 2, name: 'Second Round', label: 'From the Second Round' },
      { roundNumber: 3, name: 'Sweet 16', label: 'From the Sweet 16' },
      { roundNumber: 4, name: 'Elite Eight', label: 'From the Elite Eight' },
      { roundNumber: 5, name: 'Final Four', label: 'From the Final Four' },
    ]);
  });

  it('offers only the full bracket of a two-round event, and nothing once it is under way', () => {
    expect(bracketStartRoundOptions(2, String, { isUnderWay: false }).map((option) => option.label)).toEqual(['Full bracket']);
    expect(bracketStartRoundOptions(2, String, { isUnderWay: true })).toEqual([]);
    expect(hasSecondChanceRound(2)).toBe(false);
    expect(hasSecondChanceRound(3)).toBe(true);
  });

  it('counts an event\'s rounds by its own count, else by its sport\'s default', () => {
    expect(bracketRoundCount(buildSportEvent({ sport: 'BASKETBALL', rounds: 4 }))).toBe(4);
    expect(bracketRoundCount(buildSportEvent({ sport: 'BASKETBALL', rounds: null }))).toBe(6);
  });

  it('names a second-chance bracket\'s starting round, and no round for a full bracket', () => {
    expect(secondChanceRoundName(3, MARCH_MADNESS_ROUND)).toBe('Sweet 16');
    expect(secondChanceRoundName(1, MARCH_MADNESS_ROUND)).toBeNull();
  });
});
