import { describe, expect, it } from 'vitest';
import { SelectionType } from '@poolmaster/shared/domain';
import { contestEventsFor } from './contest-template-events';
import { buildSportEvent, openingsBeforeStart, openingsUnderWay } from './test/contest-admin-fixtures';

// Contest setup lists an event under a format exactly when the API's opening for it is OPEN
// (#1929): the page works out nothing from the event's status or readiness itself.

const BASKETBALL = { sport: 'BASKETBALL', participantType: 'TEAM', scoringFamily: 'HEAD_TO_HEAD' } as const;

describe('the events contest setup offers a format on', () => {
  it('lists an event under a format only when the API opens that format on it, so a knockout under way only under squares', () => {
    const ready = buildSportEvent({ id: 'ready', ...BASKETBALL });
    const notYet = buildSportEvent({ id: 'not-yet', ...BASKETBALL, contestOpenings: openingsBeforeStart(BASKETBALL, 'NOT_YET') });
    const underWay = buildSportEvent({
      id: 'under-way', ...BASKETBALL, status: 'IN_PROGRESS', contestEligible: false, contestOpenings: openingsUnderWay(BASKETBALL),
    });

    expect(contestEventsFor([ready, notYet, underWay], SelectionType.TIERED).map((event) => event.id)).toEqual(['ready']);
    expect(contestEventsFor([ready, notYet, underWay], SelectionType.BRACKET).map((event) => event.id)).toEqual(['ready']);
    expect(contestEventsFor([ready, notYet, underWay], SelectionType.SQUARES).map((event) => event.id)).toEqual(['ready', 'under-way']);
  });

  it('trusts the API over the event\'s own readiness flags, listing a format the API opens even on an event that reads as not ready', () => {
    const opened = buildSportEvent({ ...BASKETBALL, contestEligible: false, readinessReasons: ['EVENT_STARTED'], contestOpenings: openingsBeforeStart(BASKETBALL) });
    expect(contestEventsFor([opened], SelectionType.PICK_EM)).toHaveLength(1);
  });

  it('offers no format the event\'s definition leaves out, since the API sends no row for it', () => {
    const golf = buildSportEvent();
    expect(contestEventsFor([golf], SelectionType.BRACKET)).toEqual([]);
  });
});
