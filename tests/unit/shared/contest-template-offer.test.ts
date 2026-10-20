import { ContestTemplateEventType, isTemplateOfferedOn, Sport } from '@poolmaster/shared/domain';

const NFL = 'nfl-league';
const CFP = 'cfp-league';

describe('which events a contest template is offered on', () => {
  const week = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, rounds: 1 };
  const playoffs = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, rounds: 4 };

  it('offers a knockout template on the playoffs and not on a week of games, and a week template only on the week', () => {
    const knockout = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, eventType: ContestTemplateEventType.KNOCKOUT };
    const weekly = { ...knockout, eventType: ContestTemplateEventType.WEEK };

    expect([isTemplateOfferedOn(knockout, playoffs), isTemplateOfferedOn(knockout, week)]).toEqual([true, false]);
    expect([isTemplateOfferedOn(weekly, playoffs), isTemplateOfferedOn(weekly, week)]).toEqual([false, true]);
  });

  it('offers a template for any kind of event on both, but never on another sport league\'s or another sport\'s event', () => {
    const squares = { sport: Sport.AMERICAN_FOOTBALL, sportLeagueId: NFL, eventType: null };

    expect([isTemplateOfferedOn(squares, playoffs), isTemplateOfferedOn(squares, week)]).toEqual([true, true]);
    expect(isTemplateOfferedOn(squares, { ...playoffs, sportLeagueId: CFP })).toBe(false);
    expect(isTemplateOfferedOn({ sport: Sport.GOLF, sportLeagueId: null }, playoffs)).toBe(false);
  });

  it('offers a sport-wide template on every league of its sport', () => {
    const golfWide = { sport: Sport.GOLF, sportLeagueId: null };

    expect(isTemplateOfferedOn(golfWide, { sport: Sport.GOLF, sportLeagueId: 'lpga', rounds: 4 })).toBe(true);
  });
});
