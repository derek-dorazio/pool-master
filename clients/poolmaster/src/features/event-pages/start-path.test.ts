import { describe, expect, it } from 'vitest';
import { Sport } from '@poolmaster/shared/domain';
import { offerFixture } from './event-page-test-fixtures';
import { buildStartDestination, buildStartPath, parseStartRequest, parseStartReturnPath } from './start-path';

const REQUEST = { sport: Sport.AMERICAN_FOOTBALL, slug: 'championship-weekend', templateId: 'template-1' };

describe('Start paths', () => {
  it('reads back the page and setup a start path names, and nothing from a path missing its page or naming no sport', () => {
    expect(parseStartRequest(buildStartPath(REQUEST).split('?')[1])).toEqual(REQUEST);
    expect(parseStartReturnPath(buildStartPath({ ...REQUEST, templateId: null }))).toEqual({ ...REQUEST, templateId: null });
    expect(parseStartRequest('sport=american-football')).toBeNull();
    expect(parseStartRequest('sport=curling&page=championship-weekend')).toBeNull();
    expect(parseStartReturnPath('/invite/ABC?sport=american-football&page=x')).toBeNull();
  });

  it('sends an open offer to Create contest on its edition and starting round, and one not yet open to the league home', () => {
    const bracket = offerFixture('nfl-bracket', { startsAtRound: 3, edition: { sportEventId: 'event-9', name: 'NFL Playoffs', eventYear: 2027, startDate: '2027-01-09T18:00:00.000Z', endDate: null } });

    expect(buildStartDestination('BIGDAWGS', REQUEST, bracket))
      .toBe(`/league/BIGDAWGS/admin/contests/new?template=${bracket.template.id}&event=event-9&startRound=3`);
    expect(buildStartDestination('BIGDAWGS', REQUEST, { ...bracket, state: 'NOT_YET' }))
      .toBe('/league/BIGDAWGS?sport=american-football&page=championship-weekend&template=template-1');
    expect(buildStartDestination('BIGDAWGS', { ...REQUEST, templateId: null }, null)).toBe('/league/BIGDAWGS');
  });
});
