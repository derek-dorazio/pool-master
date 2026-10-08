import {
  compareScores,
  PARTICIPANT_SCORING_DEFINITIONS,
  rankSortedScores,
} from '@poolmaster/shared/domain';

describe('participant scoring definitions', () => {
  it('declares golf stroke play lower-is-better and renders level par as "E"', () => {
    const definition = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;

    expect(definition.direction).toBe('LOWER_IS_BETTER');
    expect([-3, 0, 4].map(definition.format)).toEqual(['-3', 'E', '+4']);
  });

  // #248 — the rule `displayType`/`displayValue` used to carry, now the registry's.
  describe('formatRound (golf)', () => {
    const { formatRound } = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;

    it('renders a completed round as its strokes', () => {
      expect(formatRound({ status: 'COMPLETED', strokes: 69, scoreToPar: -3 })).toBe('69');
    });

    it('renders a round still in progress against par, with level par as "E"', () => {
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 47, scoreToPar: -2 })).toBe('-2');
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 36, scoreToPar: 0 })).toBe('E');
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 40, scoreToPar: 3 })).toBe('+3');
    });

    it('renders a round that ended short of completion against par', () => {
      expect(formatRound({ status: 'MISSED_CUT', strokes: 78, scoreToPar: 6 })).toBe('+6');
      expect(formatRound({ status: 'DNF', strokes: 40, scoreToPar: 1 })).toBe('+1');
    });
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

// #246 — the one ranking rule, shared by contest entries and event participants.
describe('rankSortedScores', () => {
  it('gives tied scores one position shown as "T<n>", and the next score its index + 1', () => {
    expect(rankSortedScores([-5, -2, -2, 1, 1, 1, 4])).toEqual([
      { position: 1, displayPosition: '1' },
      { position: 2, displayPosition: 'T2' },
      { position: 2, displayPosition: 'T2' },
      { position: 4, displayPosition: 'T4' },
      { position: 4, displayPosition: 'T4' },
      { position: 4, displayPosition: 'T4' },
      { position: 7, displayPosition: '7' },
    ]);
  });

  it('leaves unscored items unranked', () => {
    expect(rankSortedScores([3, null, null])).toEqual([
      { position: 1, displayPosition: '1' },
      { position: null, displayPosition: null },
      { position: null, displayPosition: null },
    ]);
  });
});
