/**
 * When a Game's result is overdue (#2013): still scheduled or in progress more than 4 hours after
 * its start plus its provider league's typical game length. The sync tick raises GAME_OVERDUE on it.
 */
import { expect } from '@jest/globals';
import { gameOverdueExpectedEnd, MatchStatus, OVERDUE_AFTER_MS, overdueStartCutoff } from '@poolmaster/shared/domain';

const NOW = new Date('2026-11-28T12:00:00.000Z');
const MINUTE = 60 * 1000;
const TYPICAL_MINUTES = 180;
/** A start that puts the Game's expected end `endedAgoMs` before NOW. */
const startEnding = (endedAgoMs: number) => new Date(NOW.getTime() - endedAgoMs - TYPICAL_MINUTES * MINUTE);

describe('gameOverdueExpectedEnd', () => {
  it('answers the start plus the typical length once that is more than the wait behind now, for a scheduled or in-progress Game', () => {
    const start = startEnding(OVERDUE_AFTER_MS + MINUTE);
    const expectedEnd = new Date(start.getTime() + TYPICAL_MINUTES * MINUTE);

    expect(gameOverdueExpectedEnd({ status: MatchStatus.SCHEDULED, scheduledDate: start }, TYPICAL_MINUTES, NOW)).toEqual(expectedEnd);
    expect(gameOverdueExpectedEnd({ status: MatchStatus.IN_PROGRESS, scheduledDate: start }, TYPICAL_MINUTES, NOW)).toEqual(expectedEnd);
  });

  it('is not overdue until the wait has fully passed, nor at exactly the wait', () => {
    expect(gameOverdueExpectedEnd({ status: MatchStatus.IN_PROGRESS, scheduledDate: startEnding(OVERDUE_AFTER_MS - MINUTE) }, TYPICAL_MINUTES, NOW)).toBeNull();
    expect(gameOverdueExpectedEnd({ status: MatchStatus.IN_PROGRESS, scheduledDate: startEnding(OVERDUE_AFTER_MS) }, TYPICAL_MINUTES, NOW)).toBeNull();
  });

  it('never calls a completed, cancelled or postponed Game overdue, nor one with no scheduled start', () => {
    const start = startEnding(2 * OVERDUE_AFTER_MS);
    for (const status of [MatchStatus.COMPLETED, MatchStatus.CANCELLED, MatchStatus.POSTPONED]) {
      expect(gameOverdueExpectedEnd({ status, scheduledDate: start }, TYPICAL_MINUTES, NOW)).toBeNull();
    }
    expect(gameOverdueExpectedEnd({ status: MatchStatus.SCHEDULED, scheduledDate: null }, TYPICAL_MINUTES, NOW)).toBeNull();
  });

  it('takes the league\'s own typical length: a long game is not yet overdue when a short one would be', () => {
    const start = new Date(NOW.getTime() - OVERDUE_AFTER_MS - 200 * MINUTE);

    expect(gameOverdueExpectedEnd({ status: MatchStatus.IN_PROGRESS, scheduledDate: start }, 180, NOW)).not.toBeNull();
    expect(gameOverdueExpectedEnd({ status: MatchStatus.IN_PROGRESS, scheduledDate: start }, 300, NOW)).toBeNull();
  });
});

describe('overdueStartCutoff', () => {
  it('is the wait before now: no Game starting later can be overdue, whatever its typical length', () => {
    expect(overdueStartCutoff(NOW)).toEqual(new Date(NOW.getTime() - OVERDUE_AFTER_MS));
  });
});
