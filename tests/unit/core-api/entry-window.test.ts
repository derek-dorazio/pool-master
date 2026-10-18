/**
 * The entry-window rules of a contest of one or more events (#713): when entries can be made,
 * when each event's picks can change, when each event's picks are revealed, and which event a
 * contest's pages open on.
 */
import { ContestStatus, SportEventStatus } from '@poolmaster/shared/domain';
import {
  areContestEntriesOpen,
  areEventPicksOpen,
  areEventPicksRevealed,
  currentContestEvent,
} from '../../../packages/core-api/src/modules/contests/entry-window';

const NOW = new Date('2026-05-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function event(id: string, startOffsetHours: number, status: SportEventStatus = SportEventStatus.SCHEDULED) {
  return { id, status, startDate: new Date(NOW.getTime() + startOffsetHours * HOUR) };
}

const played = event('masters', -30 * 24, SportEventStatus.COMPLETED);
const teedOffLate = event('pga-late-update', -1); // start time passed, status not yet moved on
const inProgressEarly = event('pga-early', 5, SportEventStatus.IN_PROGRESS);
const upcoming = event('us-open', 24);
const later = event('open-championship', 24 * 30);

describe('areContestEntriesOpen — joining, renaming and leaving a contest', () => {
  it('opens entries on an OPEN, undrawn contest none of whose events has started', () => {
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [upcoming, later], NOW)).toBe(true);
  });

  it('closes entries once any of the contest\'s events has started, though later ones are still to come', () => {
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [teedOffLate, later], NOW)).toBe(false);
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [inProgressEarly, later], NOW)).toBe(false);
  });

  it.each([ContestStatus.DRAFT, ContestStatus.ACTIVE, ContestStatus.COMPLETED])(
    'closes entries on a %s contest even before any event starts',
    (status) => {
      expect(areContestEntriesOpen({ status }, [upcoming], NOW)).toBe(false);
    },
  );

  it('closes entries once a random draw has dealt, before the event starts', () => {
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN, drawnAt: NOW }, [upcoming], NOW)).toBe(false);
  });
});

describe('areEventPicksOpen — changing and submitting one event\'s picks', () => {
  it('takes picks for an event still to start while the contest is OPEN', () => {
    expect(areEventPicksOpen({ status: ContestStatus.OPEN }, upcoming, NOW)).toBe(true);
  });

  it('still takes picks for a later event on an ACTIVE contest whose first event is being played', () => {
    expect(areEventPicksOpen({ status: ContestStatus.ACTIVE }, later, NOW)).toBe(true);
  });

  it('closes an event\'s picks at its scheduled start, before its status is moved on', () => {
    expect(areEventPicksOpen({ status: ContestStatus.ACTIVE }, teedOffLate, NOW)).toBe(false);
  });

  it('closes an event\'s picks once it is marked in progress, before its scheduled start', () => {
    expect(areEventPicksOpen({ status: ContestStatus.ACTIVE }, inProgressEarly, NOW)).toBe(false);
  });

  it.each([ContestStatus.DRAFT, ContestStatus.COMPLETED])(
    'takes no picks on a %s contest, even for an event still to start',
    (status) => {
      expect(areEventPicksOpen({ status }, upcoming, NOW)).toBe(false);
    },
  );

  it('takes no picks once a random draw has dealt', () => {
    expect(areEventPicksOpen({ status: ContestStatus.OPEN, drawnAt: NOW }, upcoming, NOW)).toBe(false);
  });
});

describe('areEventPicksRevealed — who may see one event\'s picks', () => {
  it.each([ContestStatus.DRAFT, ContestStatus.OPEN])(
    'keeps every event\'s picks hidden on a %s contest, even one whose start has passed',
    (status) => {
      expect(areEventPicksRevealed({ status }, teedOffLate, NOW)).toBe(false);
    },
  );

  it('reveals a started event\'s picks on an ACTIVE contest but keeps a later event\'s picks hidden', () => {
    const contest = { status: ContestStatus.ACTIVE };

    expect(areEventPicksRevealed(contest, played, NOW)).toBe(true);
    expect(areEventPicksRevealed(contest, teedOffLate, NOW)).toBe(true);
    expect(areEventPicksRevealed(contest, inProgressEarly, NOW)).toBe(true);
    expect(areEventPicksRevealed(contest, later, NOW)).toBe(false);
  });

  it('reveals every event\'s picks once the contest is COMPLETED, an unplayed one too', () => {
    expect(areEventPicksRevealed({ status: ContestStatus.COMPLETED }, later, NOW)).toBe(true);
  });

  it('reveals a dealt draw\'s picks while the contest is still OPEN', () => {
    expect(areEventPicksRevealed({ status: ContestStatus.OPEN, drawnAt: NOW }, upcoming, NOW)).toBe(true);
  });
});

describe('currentContestEvent — the event a contest\'s pages open on', () => {
  it('opens on the first event in sequence that has not started', () => {
    expect(currentContestEvent([played, teedOffLate, upcoming, later], NOW)?.id).toBe('us-open');
  });

  it('opens on the last event once every event has started', () => {
    expect(currentContestEvent([played, teedOffLate], NOW)?.id).toBe('pga-late-update');
  });

  it('answers no event for a contest with none', () => {
    const none: ReturnType<typeof event>[] = [];
    expect(currentContestEvent(none, NOW)?.id).toBeUndefined();
  });
});
