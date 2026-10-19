import { Sport, getSportDefinition } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildBracketRounds, describeBracketClose, describeOpenSide } from './bracket-layout';
import { emptyBracketGames, secondChanceBracketGames } from './test/bracket-fixtures';

const BASKETBALL_ROUND = getSportDefinition(Sport.BASKETBALL).roundLabel;

describe('bracket layout from a later starting round', () => {
  it('names a second-chance bracket\'s rounds for where they fall in the whole bracket, its first round being the Elite Eight', () => {
    const rounds = buildBracketRounds(secondChanceBracketGames(), BASKETBALL_ROUND);
    expect(rounds.map((round) => [round.roundNumber, round.label])).toEqual([
      [4, 'Elite Eight'],
      [5, 'Final Four'],
      [6, 'National Championship'],
    ]);
    expect(rounds[0]?.regions.map((region) => region.regionLabel)).toEqual(['East', 'West']);
  });

  it('closes a second-chance bracket at its first round\'s first game, and a full bracket at the event\'s start', () => {
    expect(describeBracketClose(buildBracketRounds(secondChanceBracketGames(), BASKETBALL_ROUND), 'opening tip-off'))
      .toBe('the first game of the Elite Eight');
    expect(describeBracketClose(buildBracketRounds(emptyBracketGames(), BASKETBALL_ROUND), 'opening tip-off'))
      .toBe('the opening tip-off');
    expect(describeBracketClose([], 'opening tip-off')).toBe('the opening tip-off');
  });

  it('has a second-chance bracket\'s first round wait on no earlier round, and its later rounds wait on the round before', () => {
    const rounds = buildBracketRounds(secondChanceBracketGames(), BASKETBALL_ROUND);
    expect(describeOpenSide({ roundNumber: 4 }, rounds)).toBe('To be decided');
    expect(describeOpenSide({ roundNumber: 5 }, rounds)).toBe('Elite Eight winner');
  });
});
