import {
  deriveGolfPrices,
  deriveGolfTournamentRounds,
  deriveSeedNumbersAndOdds,
} from '../../../packages/core-api/src/modules/golf/golf-seeding-algorithm';
import { standardEventPricing } from '../../support/budget-pricing';

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
  it('pool-master-2re assigns seedNumber 1..N by ascending ranking', () => {
    const roster = [
      { participantId: 'p-3', ranking: 30 },
      { participantId: 'p-1', ranking: 1 },
      { participantId: 'p-2', ranking: 15 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result.map((r) => [r.participantId, r.seedNumber])).toEqual([
      ['p-1', 1],
      ['p-2', 2],
      ['p-3', 3],
    ]);
  });

  it('pool-master-2re sorts null ranking last', () => {
    const roster = [
      { participantId: 'p-null', ranking: null },
      { participantId: 'p-1', ranking: 5 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result.map((r) => r.participantId)).toEqual(['p-1', 'p-null']);
  });

  it('pool-master-2re uses the injected random to break ties deterministically, never repeating a seed', () => {
    const roster = [
      { participantId: 'p-a', ranking: 10 },
      { participantId: 'p-b', ranking: 10 },
      { participantId: 'p-c', ranking: 10 },
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
      { participantId: 'p-1', ranking: 1 },
      { participantId: 'p-2', ranking: 2 },
      { participantId: 'p-3', ranking: 3 },
    ];

    const result = deriveSeedNumbersAndOdds(roster, fixedSequence([0.5]));

    expect(result[0].oddsToWin).toBeLessThan(result[1].oddsToWin);
    expect(result[1].oddsToWin).toBeLessThan(result[2].oddsToWin);
  });

  it('pool-master-2re returns an empty array for an empty roster', () => {
    expect(deriveSeedNumbersAndOdds([], fixedSequence([0.5]))).toEqual([]);
  });
});

describe('deriveGolfPrices — the budget pricing curve (#93)', () => {
  const standard = standardEventPricing();
  const field = (size: number) => Array.from({ length: size }, (_, i) => ({ participantId: `p-${i + 1}`, seedNumber: i + 1 }));

  it('orders by the field\'s existing seedNumber, not a fresh sort', () => {
    const result = deriveGolfPrices([
      { participantId: 'p-3', seedNumber: 3 },
      { participantId: 'p-1', seedNumber: 1 },
      { participantId: 'p-2', seedNumber: 2 },
    ], standard);

    expect(result.map((r) => r.participantId)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('prices a 144-golfer field with the Standard profile from $12,000 at the top to $6,000 at the bottom, steepest at the top', () => {
    const prices = deriveGolfPrices(field(144), standard).map((r) => r.price);

    expect([1, 5, 10, 20, 40, 72, 144].map((seed) => prices[seed - 1])).toEqual([12000, 11400, 10600, 9400, 7700, 6400, 6000]);
  });

  it('makes the cap bind: the six dearest golfers cost more than the $50,000 cap and the six cheapest less', () => {
    const prices = deriveGolfPrices(field(144), standard).map((r) => r.price);
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

    expect(sum(prices.slice(0, 6))).toBeGreaterThan(standard.salaryCap);
    expect(sum(prices.slice(-6))).toBeLessThan(standard.salaryCap);
  });

  it('rounds every price to the profile\'s unit: whole $10s with the Small profile', () => {
    const small = { ...standard, salaryCap: 5000, unit: 10 };
    const prices = deriveGolfPrices(field(37), small).map((r) => r.price);

    expect(prices.every((price) => price % 10 === 0)).toBe(true);
    expect(prices[0]).toBe(1200);
    expect(prices[prices.length - 1]).toBe(600);
  });

  it('places golfers by position, so a gap in seed numbers left by a withdrawal still prices the last golfer at the floor', () => {
    const result = deriveGolfPrices([
      { participantId: 'p-1', seedNumber: 1 },
      { participantId: 'p-2', seedNumber: 2 },
      { participantId: 'p-9', seedNumber: 9 },
    ], standard);

    expect(result.map((r) => r.price)).toEqual([12000, 6400, 6000]);
  });

  it('prices golfers with no seed after every seeded golfer, keeping their given order', () => {
    const result = deriveGolfPrices([
      { participantId: 'guest-a', seedNumber: null },
      { participantId: 'p-2', seedNumber: 2 },
      { participantId: 'guest-b', seedNumber: null },
      { participantId: 'p-1', seedNumber: 1 },
    ], standard);

    expect(result.map((r) => r.participantId)).toEqual(['p-1', 'p-2', 'guest-a', 'guest-b']);
    expect(result[result.length - 1]?.price).toBe(6000);
  });

  it('prices a straight line with steepness 1', () => {
    const prices = deriveGolfPrices(field(3), { ...standard, steepness: 1 }).map((r) => r.price);

    expect(prices).toEqual([12000, 9000, 6000]);
  });

  it('prices a field of one golfer at the top share', () => {
    expect(deriveGolfPrices([{ participantId: 'p-1', seedNumber: 1 }], standard)).toEqual([
      { participantId: 'p-1', price: 12000 },
    ]);
  });

  it('returns an empty array for an empty field', () => {
    expect(deriveGolfPrices([], standard)).toEqual([]);
  });
});

describe('deriveGolfTournamentRounds', () => {
  const startDate = new Date('2027-04-08T00:00:00.000Z');

  it('pool-master-5h3 defaults to 4 sequential-daily rounds with round 4 on endDate when supplied', () => {
    const endDate = new Date('2027-04-12T00:00:00.000Z');

    const result = deriveGolfTournamentRounds(startDate, endDate);

    expect(result).toEqual([
      { roundNumber: 1, scheduledDate: startDate, scheduledEndAt: null },
      { roundNumber: 2, scheduledDate: new Date('2027-04-09T00:00:00.000Z'), scheduledEndAt: null },
      { roundNumber: 3, scheduledDate: new Date('2027-04-10T00:00:00.000Z'), scheduledEndAt: null },
      { roundNumber: 4, scheduledDate: endDate, scheduledEndAt: null },
    ]);
  });

  it('pool-master-5h3 falls back to startDate + 3 days for round 4 when endDate is absent too', () => {
    const result = deriveGolfTournamentRounds(startDate, null);

    expect(result[3]).toEqual({
      roundNumber: 4,
      scheduledDate: new Date('2027-04-11T00:00:00.000Z'),
      scheduledEndAt: null,
    });
  });

  it('pool-master-5h3 uses an explicit provider-supplied round schedule verbatim when present', () => {
    const providerRounds = [
      { roundNumber: 1, scheduledDate: new Date('2027-04-08T08:00:00.000Z'), scheduledEndAt: null },
      { roundNumber: 2, scheduledDate: new Date('2027-04-09T08:00:00.000Z'), scheduledEndAt: null },
    ];

    const result = deriveGolfTournamentRounds(startDate, null, providerRounds);

    expect(result).toBe(providerRounds);
  });

  it('pool-master-5h3 ignores an empty provider-supplied round array and falls back to the default', () => {
    const result = deriveGolfTournamentRounds(startDate, null, []);

    expect(result).toHaveLength(4);
  });
});
