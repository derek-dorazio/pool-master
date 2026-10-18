/**
 * The entry-window rules of a contest of one or more events (#713): when entries can be made,
 * when each event's picks can change, when each event's picks are revealed, and which event a
 * contest's pages open on.
 */
import { ContestStatus, MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
import {
  PickWindow,
  areContestEntriesOpen,
  areEventPicksOpen,
  areEventPicksRevealed,
  areMatchPicksOpen,
  areMatchPicksRevealed,
  currentContestEvent,
  hasMatchStarted,
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

// A week of pick'em (#716): each game's pick locks, and is revealed, at that game's own kickoff.
function game(kickoffOffsetHours: number | null, status: MatchStatus = MatchStatus.SCHEDULED) {
  return {
    status,
    scheduledDate: kickoffOffsetHours === null ? null : new Date(NOW.getTime() + kickoffOffsetHours * HOUR),
  };
}

// The week's event started on Thursday's kickoff; its status has not been moved on yet.
const weekUnderway = event('week-6', -2);
const weekAhead = event('week-7', 48);
const thursdayGame = game(-2);
const sundayGame = game(70);

describe('hasMatchStarted — a game\'s kickoff', () => {
  it('starts a game at its own scheduled time, not its event\'s start', () => {
    expect(hasMatchStarted(thursdayGame, weekUnderway, NOW)).toBe(true);
    expect(hasMatchStarted(game(3), weekUnderway, NOW)).toBe(false);
  });

  it('falls back to the event\'s start for a game with no scheduled time', () => {
    expect(hasMatchStarted(game(null), weekUnderway, NOW)).toBe(true);
    expect(hasMatchStarted(game(null), weekAhead, NOW)).toBe(false);
  });

  it.each([MatchStatus.IN_PROGRESS, MatchStatus.COMPLETED, MatchStatus.CANCELLED])(
    'starts a game whose status has moved on to %s before its scheduled time',
    (status) => {
      expect(hasMatchStarted(game(5, status), weekAhead, NOW)).toBe(true);
    },
  );
});

describe('areMatchPicksOpen — changing one game\'s pick', () => {
  const open = { status: ContestStatus.OPEN };
  const active = { status: ContestStatus.ACTIVE };

  it('locks a game\'s pick at its own kickoff while a later game of the same week stays open', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, thursdayGame, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, sundayGame, NOW)).toBe(true);
  });

  it('locks a game with no scheduled time at its event\'s start', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, game(null), NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, open, weekAhead, game(null), NOW)).toBe(true);
  });

  it('locks a game whose status moved on before its scheduled kickoff', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, open, weekAhead, game(50, MatchStatus.IN_PROGRESS), NOW)).toBe(false);
  });

  it.each([SportEventStatus.COMPLETED, SportEventStatus.CANCELLED])(
    'locks every game of a %s event, even one whose kickoff is still to come',
    (status) => {
      expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, event('week-6', -2, status), sundayGame, NOW)).toBe(false);
    },
  );

  it.each([ContestStatus.DRAFT, ContestStatus.COMPLETED])(
    'takes no game pick on a %s contest',
    (status) => {
      expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, { status }, weekAhead, sundayGame, NOW)).toBe(false);
    },
  );

  it('takes no game pick on a drawn contest', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, { status: ContestStatus.OPEN, drawnAt: NOW }, weekAhead, sundayGame, NOW)).toBe(false);
  });

  it('under an event-start window, locks every game at the event\'s start whatever its own kickoff', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, NOW))
      .toBe(areEventPicksOpen(active, weekUnderway, NOW));
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, open, weekAhead, game(-1), NOW)).toBe(true);
  });
});

describe('areMatchPicksRevealed — who may see one game\'s pick', () => {
  const active = { status: ContestStatus.ACTIVE };

  it('reveals a game\'s pick at its own kickoff, while a later game\'s pick stays hidden', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, weekUnderway, thursdayGame, NOW)).toBe(true);
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, weekUnderway, sundayGame, NOW)).toBe(false);
  });

  it.each([ContestStatus.DRAFT, ContestStatus.OPEN])(
    'reveals no pick on a %s contest, even of a game that has kicked off',
    (status) => {
      expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, { status }, weekUnderway, thursdayGame, NOW)).toBe(false);
    },
  );

  it('reveals every pick of a COMPLETED contest', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, { status: ContestStatus.COMPLETED }, weekAhead, sundayGame, NOW)).toBe(true);
  });

  it.each([SportEventStatus.COMPLETED, SportEventStatus.CANCELLED])(
    'reveals every pick of a %s event on a live contest',
    (status) => {
      expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, event('week-6', -2, status), sundayGame, NOW)).toBe(true);
    },
  );

  it('under an event-start window, reveals a game\'s pick with its event\'s, whatever its own kickoff', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, NOW))
      .toBe(areEventPicksRevealed(active, weekUnderway, NOW));
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, NOW)).toBe(true);
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekAhead, game(-1), NOW)).toBe(false);
  });
});
