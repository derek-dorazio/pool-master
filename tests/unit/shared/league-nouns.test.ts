import { describe, expect, it } from '@jest/globals';
import { SPORT_LEAGUE_NOUNS, Sport, SportLeagueNoun, sportLeagueNounOf } from '@poolmaster/shared/domain';

describe('sportLeagueNounOf — what screens call one sport league (#834)', () => {
  it('calls a sport league with no noun of its own what its sport calls one: the ATP is a tour', () => {
    expect(sportLeagueNounOf(Sport.TENNIS, null)).toEqual({ one: 'tour', many: 'tours' });
  });

  it('calls a sport league by its own noun when it has one: the NCAA\'s tennis championships are leagues', () => {
    expect(sportLeagueNounOf(Sport.TENNIS, SportLeagueNoun.LEAGUE)).toEqual({ one: 'league', many: 'leagues' });
    expect(sportLeagueNounOf(Sport.GOLF, SportLeagueNoun.LEAGUE)).toBe(SPORT_LEAGUE_NOUNS[SportLeagueNoun.LEAGUE]);
  });
});
