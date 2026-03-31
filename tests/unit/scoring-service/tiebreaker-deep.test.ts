import {
  evaluateTiebreaker,
  type TiebreakerData,
} from '../../../packages/core-api/src/modules/scoring/engine/tiebreaker';
import type { TiebreakerConfig } from '@poolmaster/shared/domain/scoring-config';

// --- Helpers ---

function makeEntry(overrides: Partial<TiebreakerData> = {}): TiebreakerData {
  return { entryId: 'e1', totalScore: 100, ...overrides };
}

function configFor(method: string): TiebreakerConfig {
  return { primary: method } as TiebreakerConfig;
}

// ========================================================================
// Tiebreaker resolution — compareSingle via evaluateTiebreaker
// ========================================================================

describe('tiebreaker: CHAMPIONSHIP_SCORE_PREDICTION', () => {
  const config = configFor('CHAMPIONSHIP_SCORE_PREDICTION');

  it('returns -1 when entry A is closer to actual value', () => {
    const a = makeEntry({ tiebreakerPrediction: 42 });
    const b = makeEntry({ entryId: 'e2', tiebreakerPrediction: 50 });
    expect(evaluateTiebreaker(config, a, b, 40)).toBe(-1);
  });

  it('returns 1 when entry B is closer to actual value', () => {
    const a = makeEntry({ tiebreakerPrediction: 50 });
    const b = makeEntry({ entryId: 'e2', tiebreakerPrediction: 42 });
    expect(evaluateTiebreaker(config, a, b, 40)).toBe(1);
  });

  it('returns 0 when both equally close', () => {
    const a = makeEntry({ tiebreakerPrediction: 38 });
    const b = makeEntry({ entryId: 'e2', tiebreakerPrediction: 42 });
    expect(evaluateTiebreaker(config, a, b, 40)).toBe(0);
  });

  it('returns 0 when actualValue is undefined', () => {
    const a = makeEntry({ tiebreakerPrediction: 38 });
    const b = makeEntry({ entryId: 'e2', tiebreakerPrediction: 42 });
    expect(evaluateTiebreaker(config, a, b, undefined)).toBe(0);
  });
});

describe('tiebreaker: MOST_CORRECT_PICKS', () => {
  const config = configFor('MOST_CORRECT_PICKS');

  it('returns -1 when A has more correct picks', () => {
    const a = makeEntry({ correctPicks: 8 });
    const b = makeEntry({ entryId: 'e2', correctPicks: 5 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });

  it('returns 0 when equal', () => {
    const a = makeEntry({ correctPicks: 5 });
    const b = makeEntry({ entryId: 'e2', correctPicks: 5 });
    expect(evaluateTiebreaker(config, a, b)).toBe(0);
  });
});

describe('tiebreaker: EARLIER_SUBMISSION', () => {
  const config = configFor('EARLIER_SUBMISSION');

  it('returns -1 when A submitted earlier', () => {
    const a = makeEntry({ submittedAt: new Date('2026-03-01T10:00:00Z') });
    const b = makeEntry({ entryId: 'e2', submittedAt: new Date('2026-03-01T12:00:00Z') });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });

  it('returns 0 when either submission date is missing', () => {
    const a = makeEntry({});
    const b = makeEntry({ entryId: 'e2', submittedAt: new Date('2026-03-01T12:00:00Z') });
    expect(evaluateTiebreaker(config, a, b)).toBe(0);
  });
});

describe('tiebreaker: BEST_SINGLE_SCORE', () => {
  const config = configFor('BEST_SINGLE_SCORE');

  it('returns -1 when A has a higher best single score', () => {
    const a = makeEntry({ bestSingleScore: 30 });
    const b = makeEntry({ entryId: 'e2', bestSingleScore: 20 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });
});

describe('tiebreaker: MOST_BIRDIES', () => {
  const config = configFor('MOST_BIRDIES');

  it('returns -1 when A has more birdies', () => {
    const a = makeEntry({ birdieCount: 12 });
    const b = makeEntry({ entryId: 'e2', birdieCount: 8 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });
});

describe('tiebreaker: LOWEST_ROUND', () => {
  const config = configFor('LOWEST_ROUND');

  it('returns -1 when A has a lower round score', () => {
    const a = makeEntry({ lowestRound: 64 });
    const b = makeEntry({ entryId: 'e2', lowestRound: 68 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });

  it('treats missing lowestRound as Infinity (loses)', () => {
    const a = makeEntry({ lowestRound: 70 });
    const b = makeEntry({ entryId: 'e2' }); // no lowestRound
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });
});

describe('tiebreaker: HEAD_TO_HEAD_RECORD', () => {
  const config = configFor('HEAD_TO_HEAD_RECORD');

  it('returns -1 when A has more head-to-head wins', () => {
    const a = makeEntry({ headToHeadWins: 3 });
    const b = makeEntry({ entryId: 'e2', headToHeadWins: 1 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });
});

describe('tiebreaker: MOST_WINS', () => {
  const config = configFor('MOST_WINS');

  it('returns -1 when A has more total wins', () => {
    const a = makeEntry({ totalWins: 5 });
    const b = makeEntry({ entryId: 'e2', totalWins: 3 });
    expect(evaluateTiebreaker(config, a, b)).toBe(-1);
  });

  it('returns 1 when B has more total wins', () => {
    const a = makeEntry({ totalWins: 2 });
    const b = makeEntry({ entryId: 'e2', totalWins: 4 });
    expect(evaluateTiebreaker(config, a, b)).toBe(1);
  });
});
