import { MatchEnding, Sport, SportLeagueNoun, getSportDefinition, sportLeagueNounOf } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { SportEventMatchDto } from '@/lib/api';
import { offLeagueRosterMessages, reseededRounds, roundStarted, unfinishedBefore } from './bracket-copy';

function match(overrides: Partial<SportEventMatchDto> & Pick<SportEventMatchDto, 'id' | 'matchNumber' | 'roundNumber'>): SportEventMatchDto {
  return {
    sportEventId: 'evt-1',
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: false,
    scheduledDate: null,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    homeSpread: null,
    periodScores: [],
    ...overrides,
  };
}

// The NFL's shape: Wild Card games link nowhere, so the Divisional round is reseeded; the
// Divisional games feed the Conference Championship by their links.
const nfl = [
  match({ id: 'm-1', matchNumber: 1, roundNumber: 1 }),
  match({ id: 'm-2', matchNumber: 2, roundNumber: 1, status: 'COMPLETED', winnerSide: 'HOME' }),
  match({ id: 'm-3', matchNumber: 3, roundNumber: 2, advancesToMatchId: 'm-5', advancesToSide: 'HOME' }),
  match({ id: 'm-4', matchNumber: 4, roundNumber: 2, advancesToMatchId: 'm-5', advancesToSide: 'AWAY' }),
  match({ id: 'm-5', matchNumber: 5, roundNumber: 3 }),
];

describe('reseededRounds', () => {
  it('names the round after one whose games link nowhere, and not the last round', () => {
    expect(reseededRounds(nfl)).toEqual([2]);
  });

  it('names no round for a bracket whose every game links to its next', () => {
    expect(reseededRounds([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, advancesToMatchId: 'm-2', advancesToSide: 'HOME' }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 2 }),
    ])).toEqual([]);
  });

  it('names no round for a week of games in a single round', () => {
    expect(reseededRounds([match({ id: 'm-1', matchNumber: 1, roundNumber: 1 }), match({ id: 'm-2', matchNumber: 2, roundNumber: 1 })])).toEqual([]);
  });
});

describe('roundStarted', () => {
  it('reads a round with every game scheduled and no quarter score as not started', () => {
    expect(roundStarted(nfl, 2)).toBe(false);
  });

  it('reads a round as started once a game is under way, or has a quarter score though still scheduled', () => {
    expect(roundStarted([match({ id: 'm-3', matchNumber: 3, roundNumber: 2, status: 'IN_PROGRESS' })], 2)).toBe(true);
    expect(roundStarted([match({ id: 'm-3', matchNumber: 3, roundNumber: 2, periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 0 }] })], 2)).toBe(true);
  });
});

describe('unfinishedBefore', () => {
  it('lists the games of the round before that have no result yet', () => {
    expect(unfinishedBefore(nfl, 2).map((game) => game.matchNumber)).toEqual([1]);
  });
});

describe('offLeagueRosterMessages', () => {
  const tennis = getSportDefinition(Sport.TENNIS).vocabulary;

  it('names a tour\'s roster for the ATP and a league\'s roster for the NCAA when a player is refused as off it', () => {
    expect(offLeagueRosterMessages(tennis, sportLeagueNounOf(Sport.TENNIS, null)).PARTICIPANT_NOT_IN_SPORT_LEAGUE)
      .toBe('That player isn\'t on this tour\'s roster, so they can\'t join this draw. Pick another.');
    expect(offLeagueRosterMessages(tennis, sportLeagueNounOf(Sport.TENNIS, SportLeagueNoun.LEAGUE)).PARTICIPANT_NOT_IN_SPORT_LEAGUE)
      .toBe('That player isn\'t on this league\'s roster, so they can\'t join this draw. Pick another.');
  });
});
