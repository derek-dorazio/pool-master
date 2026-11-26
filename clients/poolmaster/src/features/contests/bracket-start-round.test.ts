import { SelectionType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  bracketStartRoundOptions,
  contestSecondChanceRoundName,
  secondChanceRoundName,
} from './bracket-start-round';
import { buildManagedContest } from './test/contest-admin-fixtures';
import { tournamentRoundName } from './test/round-slots';

const MARCH_MADNESS_ROUND = tournamentRoundName;

describe('where a bracket can start', () => {
  it('names each round the API says a bracket can start at, the full bracket as such and a later round as a second chance', () => {
    expect(bracketStartRoundOptions([1], MARCH_MADNESS_ROUND)).toEqual([
      { roundNumber: 1, name: 'First Round', label: 'Full bracket' },
    ]);
    expect(bracketStartRoundOptions([2, 3, 4, 5], MARCH_MADNESS_ROUND)).toEqual([
      { roundNumber: 2, name: 'Round of 32', label: 'From the Round of 32' },
      { roundNumber: 3, name: 'Sweet 16', label: 'From the Sweet 16' },
      { roundNumber: 4, name: 'Elite Eight', label: 'From the Elite Eight' },
      { roundNumber: 5, name: 'Final Four', label: 'From the Final Four' },
    ]);
    expect(bracketStartRoundOptions([], MARCH_MADNESS_ROUND)).toEqual([]);
  });

  it('names a second-chance bracket\'s starting round, and no round for a full bracket', () => {
    expect(secondChanceRoundName(3, MARCH_MADNESS_ROUND)).toBe('Sweet 16');
    expect(secondChanceRoundName(1, MARCH_MADNESS_ROUND)).toBeNull();
  });

  it('names a contest\'s second-chance starting round from its configuration, and none for a full bracket, another format or a configuration not read yet', () => {
    const bracket = (startsAtRound: number) => buildManagedContest({
      configuration: { id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 1, selectionType: SelectionType.BRACKET, startsAtRound },
    }).configuration;

    expect(contestSecondChanceRoundName(bracket(3), MARCH_MADNESS_ROUND)).toBe('Sweet 16');
    expect(contestSecondChanceRoundName(bracket(1), MARCH_MADNESS_ROUND)).toBeNull();
    expect(contestSecondChanceRoundName(buildManagedContest().configuration, MARCH_MADNESS_ROUND)).toBeNull();
    expect(contestSecondChanceRoundName(undefined, MARCH_MADNESS_ROUND)).toBeNull();
  });
});
