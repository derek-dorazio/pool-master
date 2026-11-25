import { describe, expect, it } from 'vitest';
import { sportLeagueChoiceLabel, sportLeagueChoiceObject, sportLeagueChoiceSearch } from './sport-league-choice';

const NHL = { urlSegment: 'nhl', name: 'NHL' };

describe('the choice\'s words and link', () => {
  it('spells a whole sport and a league in the page\'s link by their URL segments, and nothing for every sport', () => {
    expect(sportLeagueChoiceSearch(null, 'nhl')).toBe('');
    expect(sportLeagueChoiceSearch('horse-racing')).toBe('?sport=horse-racing');
    expect(sportLeagueChoiceSearch('hockey', 'nhl')).toBe('?sport=hockey&league=nhl');
  });

  it('names a chosen league as one chip does, and nothing with no league chosen', () => {
    expect(sportLeagueChoiceLabel({ league: null })).toBeNull();
    expect(sportLeagueChoiceLabel({ league: NHL })).toBe('NHL');
  });

  it('says what a heading plays: the sport in lower case, or the league', () => {
    const hockey = { sport: 'HOCKEY' as const, urlSegment: 'hockey', name: 'Hockey', leagues: [NHL], count: 1 };
    expect(sportLeagueChoiceObject({ sport: null, league: null })).toBeNull();
    expect(sportLeagueChoiceObject({ sport: hockey, league: null })).toBe('hockey');
    expect(sportLeagueChoiceObject({ sport: hockey, league: NHL })).toBe('NHL');
  });
});
