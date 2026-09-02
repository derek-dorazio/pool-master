import {
  deriveGolfPrices,
  deriveSeedNumbersAndOdds,
} from '../../../packages/core-api/src/modules/golf/golf-seeding-algorithm';

/** Deterministic sequence injector matching ScenarioStoreOptions's random DI pattern. */
function fixedSequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

describe('deriveSeedNumbersAndOdds', () => {
  it('pool-master-2re assigns seedNumber 1..N by ascending worldRanking', () => {
    const roster = [
      { participantId: 'p-3', worldRanking: 30 },
      { participantId: 'p-1', worldRanking: 1 },
      { participantId: 'p-2', worldRanking: 15 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result.map((r) => [r.participantId, r.seedNumber])).toEqual([
      ['p-1', 1],
      ['p-2', 2],
      ['p-3', 3],
    ]);
  });

  it('pool-master-2re sorts null worldRanking last', () => {
    const roster = [
      { participantId: 'p-null', worldRanking: null },
      { participantId: 'p-1', worldRanking: 5 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result.map((r) => r.participantId)).toEqual(['p-1', 'p-null']);
  });

  it('pool-master-2re uses the injected random to break ties deterministically, never repeating a seed', () => {
    const roster = [
      { participantId: 'p-a', worldRanking: 10 },
      { participantId: 'p-b', worldRanking: 10 },
      { participantId: 'p-c', worldRanking: 10 },
    ];

    // Fisher-Yates with a fixed 0.5 draw each step is deterministic and repeatable.
    const first = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));
    const second = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(first.map((r) => r.seedNumber)).toEqual([1, 2, 3]);
    expect(first.map((r) => r.participantId)).toEqual(second.map((r) => r.participantId));
  });

  it('pool-master-2re gives a lower position (better rank) a shorter price (larger oddsToWin denominator implies smaller probability wins bigger)', () => {
    // With jitter neutralized (random() = 0.5 -> jitter = 1), weight(i) = 1/position(i)
    // is strictly decreasing, so oddsToWin (1/probability) is strictly increasing.
    const roster = [
      { participantId: 'p-1', worldRanking: 1 },
      { participantId: 'p-2', worldRanking: 2 },
      { participantId: 'p-3', worldRanking: 3 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result[0].oddsToWin).toBeLessThan(result[1].oddsToWin);
    expect(result[1].oddsToWin).toBeLessThan(result[2].oddsToWin);
  });

  it('pool-master-2re returns an empty array for an empty roster', () => {
    expect(deriveSeedNumbersAndOdds([], fixedSequence([0.5]))).toEqual([]);
  });
});

describe('deriveGolfPrices', () => {
  it('pool-master-2re orders by the field\'s existing seedNumber, not a fresh sort', () => {
    const field = [
      { participantId: 'p-3', seedNumber: 3 },
      { participantId: 'p-1', seedNumber: 1 },
      { participantId: 'p-2', seedNumber: 2 },
    ];

    const result = deriveGolfPrices(field, 10, 100, fixedSequence([0.5]));

    expect(result.map((r) => r.participantId)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('pool-master-2re puts the best seed near maxPrice and the worst near minPrice', () => {
    const field = Array.from({ length: 10 }, (_, i) => ({ participantId: `p-${i + 1}`, seedNumber: i + 1 }));

    const result = deriveGolfPrices(field, 10, 100, fixedSequence([0.5]));

    expect(result[0].price).toBeCloseTo(100, 0);
    expect(result[result.length - 1].price).toBeCloseTo(10, 0);
    expect(result.every((r) => r.price >= 10 && r.price <= 100)).toBe(true);
  });

  it('pool-master-2re returns a single entry at maxPrice when the field has only one golfer (zero range)', () => {
    const result = deriveGolfPrices([{ participantId: 'p-1', seedNumber: 1 }], 10, 100, fixedSequence([0.5]));

    expect(result).toEqual([{ participantId: 'p-1', seedNumber: 1, price: 100 }]);
  });

  it('pool-master-2re returns an empty array for an empty field', () => {
    expect(deriveGolfPrices([], 10, 100, fixedSequence([0.5]))).toEqual([]);
  });
});
