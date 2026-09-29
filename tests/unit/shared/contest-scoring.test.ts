import {
  compareScores,
  PARTICIPANT_SCORING_DEFINITIONS,
} from '@poolmaster/shared/domain';

describe('participant scoring definitions', () => {
  it('declares golf stroke play lower-is-better and renders level par as "E"', () => {
    const definition = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;

    expect(definition.direction).toBe('LOWER_IS_BETTER');
    expect([-3, 0, 4].map(definition.format)).toEqual(['-3', 'E', '+4']);
  });
});

describe('compareScores', () => {
  it('orders the lowest score first when lower is better, and the highest first when higher is better', () => {
    const scores = [2, -1, 5];

    expect([...scores].sort((l, r) => compareScores('LOWER_IS_BETTER', l, r))).toEqual([-1, 2, 5]);
    expect([...scores].sort((l, r) => compareScores('HIGHER_IS_BETTER', l, r))).toEqual([5, 2, -1]);
  });

  it('sorts an unscored value last in both directions', () => {
    const scores = [null, 3, 1];

    expect([...scores].sort((l, r) => compareScores('LOWER_IS_BETTER', l, r))).toEqual([1, 3, null]);
    expect([...scores].sort((l, r) => compareScores('HIGHER_IS_BETTER', l, r))).toEqual([3, 1, null]);
  });
});
