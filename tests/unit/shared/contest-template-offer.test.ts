import { ContestTemplateEventType, isTemplateOfferedOn, Sport } from '@poolmaster/shared/domain';
import { sportPlay } from '../../support/sport-play';

const NFL = 'nfl-league';
const CFP = 'cfp-league';

describe('which events a contest template is offered on', () => {
  const week = { sport: Sport.AMERICAN_FOOTBALL, ...sportPlay(Sport.AMERICAN_FOOTBALL), sportLeagueId: NFL, rounds: 1 };
  const playoffs = { sport: Sport.AMERICAN_FOOTBALL, ...sportPlay(Sport.AMERICAN_FOOTBALL), sportLeagueId: NFL, rounds: 4 };

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
    expect(isTemplateOfferedOn({ sport: Sport.GOLF, sportLeagueId: NFL }, playoffs)).toBe(false);
  });

  it('offers a golf setup only on its own tour\'s events, so the PGA TOUR\'s copy is never offered on an LPGA Tour event', () => {
    const pgaCopy = { sport: Sport.GOLF, sportLeagueId: 'pga' };

    expect([
      isTemplateOfferedOn(pgaCopy, { sport: Sport.GOLF, ...sportPlay(Sport.GOLF), sportLeagueId: 'pga', rounds: 4 }),
      isTemplateOfferedOn(pgaCopy, { sport: Sport.GOLF, ...sportPlay(Sport.GOLF), sportLeagueId: 'lpga', rounds: 4 }),
    ]).toEqual([true, false]);
  });
});
