import { describe, expect, it } from 'vitest';
import { groupRounds, sportLeagueChoiceLabel, sportLeagueChoiceObject, sportLeagueChoiceSearch } from './sport-league-choice';

const NHL = { slug: 'nhl', name: 'NHL', rounds: [{ slug: 'stanley-cup-final', name: 'Stanley Cup Final' }] };

describe('groupRounds', () => {
  it('puts each round under the league its parent link names, in the order given, whatever lies between them', () => {
    const grouped = groupRounds([
      { id: 'nhl', parentId: null },
      { id: 'pwhl', parentId: null },
      { id: 'final', parentId: 'nhl' },
    ]);

    expect(grouped.map(({ league, rounds }) => [league.id, rounds.map((round) => round.id)])).toEqual([['nhl', ['final']], ['pwhl', []]]);
  });

  it('keeps a round whose league is not among them as a league of its own', () => {
    expect(groupRounds([{ id: 'final', parentId: 'retired' }]).map(({ league, rounds }) => [league.id, rounds.length])).toEqual([['final', 0]]);
  });
});

describe('the choice\'s words and link', () => {
  it('spells a whole sport, a league and one part of a league in the page\'s link, and nothing for every sport', () => {
    expect(sportLeagueChoiceSearch(null, 'nhl')).toBe('');
    expect(sportLeagueChoiceSearch('HORSE_RACING')).toBe('?sport=horse-racing');
    expect(sportLeagueChoiceSearch('HOCKEY', 'nhl')).toBe('?sport=hockey&league=nhl');
    expect(sportLeagueChoiceSearch('HOCKEY', 'nhl', 'stanley-cup-final')).toBe('?sport=hockey&league=nhl&part=stanley-cup-final');
  });

  it('names a chosen league or part as one chip does, and nothing with no league chosen', () => {
    expect(sportLeagueChoiceLabel({ league: null, partSlug: null })).toBeNull();
    expect(sportLeagueChoiceLabel({ league: NHL, partSlug: null })).toBe('NHL');
    expect(sportLeagueChoiceLabel({ league: NHL, partSlug: 'nhl' })).toBe('NHL · Regular season');
    expect(sportLeagueChoiceLabel({ league: NHL, partSlug: 'stanley-cup-final' })).toBe('NHL · Stanley Cup Final');
  });

  it('says what a heading plays: the sport in lower case, the league, its regular season or the round', () => {
    const hockey = { sport: 'HOCKEY' as const, name: 'Hockey', leagues: [NHL], count: 1 };
    expect(sportLeagueChoiceObject({ sport: null, league: null, partSlug: null })).toBeNull();
    expect(sportLeagueChoiceObject({ sport: hockey, league: null, partSlug: null })).toBe('hockey');
    expect(sportLeagueChoiceObject({ sport: hockey, league: NHL, partSlug: null })).toBe('NHL');
    expect(sportLeagueChoiceObject({ sport: hockey, league: NHL, partSlug: 'nhl' })).toBe('the NHL regular season');
    expect(sportLeagueChoiceObject({ sport: hockey, league: NHL, partSlug: 'stanley-cup-final' })).toBe('the Stanley Cup Final');
  });
});
