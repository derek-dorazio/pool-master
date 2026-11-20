import { describe, expect, it } from 'vitest';
import { SelectionType } from '@poolmaster/shared/domain';
import { bracketStartRoundsOf, canEventStartRules, contestEventsFor } from './contest-template-events';
import { buildSportEvent, openingsBeforeStart, openingsUnderWay } from './test/contest-admin-fixtures';

// Contest setup lists an event under a format exactly when the API's opening for it is OPEN
// (#1929): the page works out nothing from the event's status or readiness itself.

const BASKETBALL = { sport: 'BASKETBALL', participantType: null, scoringFamily: null } as const;

describe('the events contest setup offers a format on', () => {
  it('lists an event under a format only when the API opens that format on it', () => {
    const ready = buildSportEvent({ id: 'ready', ...BASKETBALL });
    const notYet = buildSportEvent({ id: 'not-yet', ...BASKETBALL, contestOpenings: openingsBeforeStart(BASKETBALL, 'NOT_YET') });
    const underWay = buildSportEvent({
      id: 'under-way', ...BASKETBALL, status: 'IN_PROGRESS', contestEligible: false, contestOpenings: openingsUnderWay(BASKETBALL, [2, 3]),
    });

    expect(contestEventsFor([ready, notYet, underWay], SelectionType.TIERED).map((event) => event.id)).toEqual(['ready']);
    expect(contestEventsFor([ready, notYet, underWay], SelectionType.BRACKET).map((event) => event.id)).toEqual(['ready', 'under-way']);
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

describe('where a bracket on an event can start', () => {
  it('reads the starting rounds from the API: the full bracket before the start, later rounds once under way', () => {
    const ready = buildSportEvent(BASKETBALL);
    const underWay = buildSportEvent({ ...BASKETBALL, contestOpenings: openingsUnderWay(BASKETBALL, [2, 3, 4, 5]) });

    expect(bracketStartRoundsOf(ready)).toEqual([1]);
    expect(bracketStartRoundsOf(underWay)).toEqual([2, 3, 4, 5]);
    expect(bracketStartRoundsOf(buildSportEvent())).toEqual([]);
  });

  it('lets bracket rules start only at a round the API offers, and any other format\'s rules on any event', () => {
    const underWay = buildSportEvent({ ...BASKETBALL, contestOpenings: openingsUnderWay(BASKETBALL, [2, 3]) });
    const bracket = (startsAtRound: number) => ({ selectionType: SelectionType.BRACKET, startsAtRound, maxEntriesPerSquad: 1 }) as const;

    expect(canEventStartRules(bracket(3), underWay)).toBe(true);
    expect(canEventStartRules(bracket(1), underWay)).toBe(false);
    expect(canEventStartRules({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 }, underWay)).toBe(true);
  });
});
