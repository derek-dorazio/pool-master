/**
 * A match's completion time and neutral site, read from its Games (#2047): the match keeps neither,
 * so the API's mappers, the round progress and the pick'em boards all read them here.
 */
import { expect } from '@jest/globals';
import { MatchStatus, matchCompletedAt, matchIsNeutralSite, type SportEventRoundMatchGame } from '@poolmaster/shared/domain';

const T0 = new Date('2027-01-01T00:00:00.000Z');

function game(gameNumber: number, overrides: Partial<SportEventRoundMatchGame> = {}): SportEventRoundMatchGame {
  return {
    id: `game-${String(gameNumber)}`,
    sportEventId: 'event',
    sportEventRoundMatchId: 'match-1',
    sportEventSlotId: 'slot',
    gameNumber,
    scheduledDate: null,
    isNeutralSite: false,
    venue: null,
    location: null,
    status: MatchStatus.SCHEDULED,
    completedAt: null,
    movedToGameId: null,
    lastProviderNotificationAt: null,
    createdAt: T0,
    updatedAt: T0,
    sideResults: [],
    ...overrides,
  };
}

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe('matchCompletedAt', () => {
  it('reads a completed series as finished when its last game was, the latest of its Games', () => {
    const games = [game(1, { status: MatchStatus.COMPLETED, completedAt: at(10) }), game(2, { status: MatchStatus.COMPLETED, completedAt: at(30) }), game(3, { status: MatchStatus.COMPLETED, completedAt: at(20) })];

    expect(matchCompletedAt({ status: MatchStatus.COMPLETED, games })).toEqual(at(30));
  });

  it('gives a match not yet completed no completion time, though one of its games is over', () => {
    const games = [game(1, { status: MatchStatus.COMPLETED, completedAt: at(10) }), game(2)];

    expect(matchCompletedAt({ status: MatchStatus.IN_PROGRESS, games })).toBeNull();
  });

  it('gives a completed match whose Games hold no time no completion time', () => {
    expect(matchCompletedAt({ status: MatchStatus.COMPLETED, games: [game(1)] })).toBeNull();
  });
});

describe('matchIsNeutralSite', () => {
  it('reads a match as at a neutral site when every one of its Games is', () => {
    expect(matchIsNeutralSite({ games: [game(1, { isNeutralSite: true }), game(2, { isNeutralSite: true })] })).toBe(true);
  });

  it('reads a series as at home once any of its Games is played at a team\'s home', () => {
    expect(matchIsNeutralSite({ games: [game(1, { isNeutralSite: true }), game(2)] })).toBe(false);
  });
});
