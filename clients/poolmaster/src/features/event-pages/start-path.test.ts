import { describe, expect, it } from 'vitest';
import { offerFixture } from './event-page-test-fixtures';
import { buildStartDestination, buildStartPath, parseStartRequest, parseStartReturnPath } from './start-path';

const REQUEST = { sportUrlSegment: 'football', urlSegment: 'championship-weekend', templateId: 'template-1' };

describe('Start paths', () => {
  it('reads back the page and setup a start path names, and nothing from a path missing its page or naming a segment no address could have', () => {
    expect(parseStartRequest(buildStartPath(REQUEST).split('?')[1])).toEqual(REQUEST);
    expect(parseStartReturnPath(buildStartPath({ ...REQUEST, templateId: null }))).toEqual({ ...REQUEST, templateId: null });
    expect(parseStartRequest('sport=football')).toBeNull();
    expect(parseStartRequest('sport=American_Football&page=championship-weekend')).toBeNull();
    expect(parseStartReturnPath('/invite/ABC?sport=football&page=x')).toBeNull();
  });

  it('sends an open offer to Create contest on the event of its next slot and its starting round, and one not yet open to the league home', () => {
    const bracket = offerFixture('nfl-bracket', { startsAtRound: 3, nextSlot: { seasonSlotId: 'season-slot-9', sportEventId: 'event-9', name: 'NFL Playoffs', championshipYear: 2027, startDate: '2027-01-09T18:00:00.000Z', endDate: null } });

    expect(buildStartDestination('BIGDAWGS', REQUEST, bracket))
      .toBe(`/league/BIGDAWGS/admin/contests/new?template=${bracket.template.id}&event=event-9&startRound=3`);
    expect(buildStartDestination('BIGDAWGS', REQUEST, { ...bracket, state: 'NOT_YET' }))
      .toBe('/league/BIGDAWGS?sport=football&page=championship-weekend&template=template-1');
    expect(buildStartDestination('BIGDAWGS', { ...REQUEST, templateId: null }, null)).toBe('/league/BIGDAWGS');
  });
});
