/**
 * The shared readers of a match's sides and its Games' side results (#2046): every reader of a
 * side (pick'em, brackets, squares, the API's mappers) goes through them, so each case below is
 * what all of those see.
 */
import { expect } from '@jest/globals';
import {
  HomeAway,
  MatchSideOutcome,
  MatchStatus,
  PeriodKind,
  SlotKind,
  gameWinnerSideNumber,
  matchHomeAwayOf,
  matchScoreOf,
  opposingSideOf,
  sideOf,
  type SportEventRoundMatchGame,
  type SportEventRoundMatchGameSideResult,
} from '@poolmaster/shared/domain';
import { roundSlot } from '../../support/round-slots';

function sideResult(sideNumber: number, score: number | null, shootout?: number): SportEventRoundMatchGameSideResult {
  return {
    sportEventRoundMatchSideId: `side-${String(sideNumber)}`,
    sideNumber,
    score,
    homeAway: HomeAway.NONE,
    periodScores: shootout === undefined ? [] : [{ kind: PeriodKind.SHOOTOUT, periodNumber: 1, score: shootout }],
  };
}

const AT = new Date('2027-06-01T00:00:00.000Z');

function game(gameNumber: number, status: MatchStatus, sideResults: readonly SportEventRoundMatchGameSideResult[]): SportEventRoundMatchGame {
  return {
    id: `game-${String(gameNumber)}`,
    sportEventId: 'event',
    sportEventRoundMatchId: 'match-1',
    sportEventSlotId: 'slot',
    gameNumber,
    scheduledDate: null,
    isNeutralSite: false,
    status,
    completedAt: null,
    movedToGameId: null,
    lastProviderNotificationAt: null,
    sideResults,
    createdAt: AT,
    updatedAt: AT,
  };
}

const lonelyMatch = {
  id: 'match-1',
  sides: [{ id: 'side-1', sideNumber: 1, sportEventParticipantId: null, spread: null, outcome: MatchSideOutcome.PENDING }],
};

describe('a match\'s sides', () => {
  it('refuses a side number the match does not have, naming the match and the number', () => {
    expect(() => sideOf(lonelyMatch, 2)).toThrow('Match match-1 has no side 2');
  });

  it('refuses the opposing side of a match that has only the one side', () => {
    expect(() => opposingSideOf(lonelyMatch, 1)).toThrow('Match match-1 has no side opposing side 1');
  });
});

describe('where a side is billed for its match', () => {
  const placed = (sideNumber: number, homeAway: HomeAway) => ({ ...sideResult(sideNumber, null), homeAway });

  it('is where the side played Game 1, whatever a later Game of a series says', () => {
    const games = [
      game(2, MatchStatus.SCHEDULED, [placed(1, HomeAway.HOME), placed(2, HomeAway.AWAY)]),
      game(1, MatchStatus.SCHEDULED, [placed(1, HomeAway.AWAY), placed(2, HomeAway.HOME)]),
    ];
    expect([matchHomeAwayOf({ games }, 1), matchHomeAwayOf({ games }, 2)]).toEqual([HomeAway.AWAY, HomeAway.HOME]);
  });

  it('is NONE at a neutral site, for a match with no Game 1 yet, and for a side Game 1 has no result for', () => {
    expect(matchHomeAwayOf({ games: [game(1, MatchStatus.SCHEDULED, [placed(1, HomeAway.NONE)])] }, 1)).toBe(HomeAway.NONE);
    expect(matchHomeAwayOf({ games: [] }, 1)).toBe(HomeAway.NONE);
    expect(matchHomeAwayOf({ games: [game(1, MatchStatus.SCHEDULED, [placed(1, HomeAway.AWAY)])] }, 2)).toBe(HomeAway.NONE);
  });
});

describe('the side that won a Game', () => {
  it('has no winner while the Game is not completed, whatever its scores', () => {
    expect(gameWinnerSideNumber(game(1, MatchStatus.IN_PROGRESS, [sideResult(1, 3), sideResult(2, 1)]))).toBeNull();
  });

  it('has no winner when the completed Game lacks a side\'s result or a side\'s score', () => {
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 3)]))).toBeNull();
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 3), sideResult(2, null)]))).toBeNull();
  });

  it('gives the higher score the win, side 2 as readily as side 1, whatever order the results are held in', () => {
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(2, 1), sideResult(1, 3)]))).toBe(1);
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 1), sideResult(2, 3)]))).toBe(2);
  });

  it('settles a level score by the higher shoot-out, and leaves it undecided with no shoot-out or a level one', () => {
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 1, 4), sideResult(2, 1, 5)]))).toBe(2);
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 1, 5), sideResult(2, 1, 3)]))).toBe(1);
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 2), sideResult(2, 2)]))).toBeNull();
    expect(gameWinnerSideNumber(game(1, MatchStatus.COMPLETED, [sideResult(1, 2, 4), sideResult(2, 2, 4)]))).toBeNull();
  });
});

describe('a side\'s score in the match', () => {
  const single = roundSlot(SlotKind.FINAL);
  const series = { ...roundSlot(SlotKind.FINAL), seriesGames: 7 };

  it('is its Game 1 score in a single-game match, and null while the match has no Game 1', () => {
    expect(matchScoreOf({ slot: single, games: [] }, 1)).toBeNull();
  });

  it('is the Games won in a series, and null while no Game of it is decided', () => {
    const games = [
      game(1, MatchStatus.COMPLETED, [sideResult(1, 3), sideResult(2, 1)]),
      game(2, MatchStatus.COMPLETED, [sideResult(1, 0), sideResult(2, 2)]),
      game(3, MatchStatus.COMPLETED, [sideResult(1, 4), sideResult(2, 2)]),
      game(4, MatchStatus.SCHEDULED, [sideResult(1, null), sideResult(2, null)]),
    ];
    expect([matchScoreOf({ slot: series, games }, 1), matchScoreOf({ slot: series, games }, 2)]).toEqual([2, 1]);
    expect(matchScoreOf({ slot: series, games: games.slice(3) }, 1)).toBeNull();
  });
});
