/**
 * The entry-window rules of a contest of one or more events (#713): when entries can be made,
 * when each event's picks can change, when each event's picks are revealed, and which event a
 * contest's pages open on.
 */
import { withHomeAway, legacyMatch, squaresGameOf } from '../../support/match-sides';
import { ContestStatus, MatchStatus, PickEmMode, SeasonSlotStatus, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import {
  ContestCutoffKind,
  PickWindow,
  areContestEntriesOpen,
  areEventPicksOpen,
  areEventPicksRevealed,
  areMatchPicksOpen,
  areMatchPicksRevealed,
  contestCutoff,
  cutoffTiming,
  hasMatchStarted,
  hasRoundMatchStarted,
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

// A week of pick'em (#716): each game's pick locks, and is revealed, at that game's own kickoff.
function game(kickoffOffsetHours: number | null, status: MatchStatus = MatchStatus.SCHEDULED, roundNumber = 1) {
  return legacyMatch({
    id: `game-${roundNumber}-${kickoffOffsetHours ?? 'untimed'}`,
    roundNumber,
    status,
    scheduledDate: kickoffOffsetHours === null ? null : new Date(NOW.getTime() + kickoffOffsetHours * HOUR),
  });
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

describe('hasRoundMatchStarted — a game picked round by round', () => {
  it('starts an untimed game of a later round only when it moves on, not at its event\'s start (#785)', () => {
    expect(hasRoundMatchStarted(game(null, MatchStatus.SCHEDULED, 2), weekUnderway, 1, NOW)).toBe(false);
    expect(hasRoundMatchStarted(game(null, MatchStatus.IN_PROGRESS, 2), weekUnderway, 1, NOW)).toBe(true);
  });

  it('starts a timed later-round game at its time, and an untimed opening-round game at its event\'s start', () => {
    expect(hasRoundMatchStarted(game(-1, MatchStatus.SCHEDULED, 2), weekAhead, 1, NOW)).toBe(true);
    expect(hasRoundMatchStarted(game(null), weekUnderway, 1, NOW)).toBe(true);
  });

  it('keeps an untimed later-round game\'s pick open while the event is under way', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, { status: ContestStatus.ACTIVE }, weekUnderway, game(null, MatchStatus.SCHEDULED, 2), 1, NOW)).toBe(true);
  });
});

describe('areMatchPicksOpen — changing one game\'s pick', () => {
  const open = { status: ContestStatus.OPEN };
  const active = { status: ContestStatus.ACTIVE };

  it('locks a game\'s pick at its own kickoff while a later game of the same week stays open', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, thursdayGame, 1, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, sundayGame, 1, NOW)).toBe(true);
  });

  it('locks a game with no scheduled time at its event\'s start', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, game(null), 1, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, open, weekAhead, game(null), 1, NOW)).toBe(true);
  });

  it('locks a game whose status moved on before its scheduled kickoff', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, open, weekAhead, game(50, MatchStatus.IN_PROGRESS), 1, NOW)).toBe(false);
  });

  it('keeps a postponed game\'s pick open until its new kickoff while the week is under way, then locks it', () => {
    const postponedToMonday = game(26, MatchStatus.POSTPONED);

    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, postponedToMonday, 1, NOW)).toBe(true);
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, weekUnderway, postponedToMonday, 1, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, postponedToMonday, 1, new Date(NOW.getTime() + 26 * HOUR))).toBe(false);
  });

  it('locks a postponed game with no new time yet at its old kickoff, as it was put off after picks closed', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, weekUnderway, game(-2, MatchStatus.POSTPONED), 1, NOW)).toBe(false);
  });

  it.each([SportEventStatus.COMPLETED, SportEventStatus.CANCELLED])(
    'locks every game of a %s event, even one whose kickoff is still to come',
    (status) => {
      expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, active, event('week-6', -2, status), sundayGame, 1, NOW)).toBe(false);
    },
  );

  it.each([ContestStatus.DRAFT, ContestStatus.COMPLETED])(
    'takes no game pick on a %s contest',
    (status) => {
      expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, { status }, weekAhead, sundayGame, 1, NOW)).toBe(false);
    },
  );

  it('takes no game pick on a drawn contest', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_MATCH_START, { status: ContestStatus.OPEN, drawnAt: NOW }, weekAhead, sundayGame, 1, NOW)).toBe(false);
  });

  it('under an event-start window, locks every game at the event\'s start whatever its own kickoff', () => {
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, 1, NOW))
      .toBe(areEventPicksOpen(active, weekUnderway, NOW));
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, 1, NOW)).toBe(false);
    expect(areMatchPicksOpen(PickWindow.UNTIL_EVENT_START, open, weekAhead, game(-1), 1, NOW)).toBe(true);
  });
});

describe('areMatchPicksRevealed — who may see one game\'s pick', () => {
  const active = { status: ContestStatus.ACTIVE };

  it('reveals a game\'s pick at its own kickoff, while a later game\'s pick stays hidden', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, weekUnderway, thursdayGame, 1, NOW)).toBe(true);
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, weekUnderway, sundayGame, 1, NOW)).toBe(false);
  });

  it.each([ContestStatus.DRAFT, ContestStatus.OPEN])(
    'reveals no pick on a %s contest, even of a game that has kicked off',
    (status) => {
      expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, { status }, weekUnderway, thursdayGame, 1, NOW)).toBe(false);
    },
  );

  it('reveals every pick of a COMPLETED contest', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, { status: ContestStatus.COMPLETED }, weekAhead, sundayGame, 1, NOW)).toBe(true);
  });

  it.each([SportEventStatus.COMPLETED, SportEventStatus.CANCELLED])(
    'reveals every pick of a %s event on a live contest',
    (status) => {
      expect(areMatchPicksRevealed(PickWindow.UNTIL_MATCH_START, active, event('week-6', -2, status), sundayGame, 1, NOW)).toBe(true);
    },
  );

  it('under an event-start window, reveals a game\'s pick with its event\'s, whatever its own kickoff', () => {
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, 1, NOW))
      .toBe(areEventPicksRevealed(active, weekUnderway, NOW));
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekUnderway, sundayGame, 1, NOW)).toBe(true);
    expect(areMatchPicksRevealed(PickWindow.UNTIL_EVENT_START, active, weekAhead, game(-1), 1, NOW)).toBe(false);
  });
});

describe('contestCutoff — where a contest\'s window closes', () => {
  it('closes every contest but squares at the first Game of the slots it covers, a bracket included', () => {
    const coveredSlots = [{ sportEventId: 'playoffs', status: SeasonSlotStatus.SCHEDULED, startsAt: NOW, isTestData: false }];
    expect(contestCutoff(undefined)).toEqual({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots: [] });
    expect(contestCutoff({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, { coveredSlots })).toEqual({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots });
    expect(contestCutoff({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false })).toEqual({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots: [] });
    expect(contestCutoff({ selectionType: SelectionType.BRACKET })).toEqual({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots: [] });
  });
});

describe('cutoffTiming — a contest\'s window opens and closes at its first covered Game (#2013)', () => {
  const playoffs = event('playoffs', -48, SportEventStatus.IN_PROGRESS);
  const slot = (sportEventId: string, status: SeasonSlotStatus, startOffsetHours: number | null, isTestData = false) => ({
    sportEventId, status, isTestData, startsAt: startOffsetHours === null ? null : new Date(NOW.getTime() + startOffsetHours * HOUR),
  });
  const covering = (...coveredSlots: ReturnType<typeof slot>[]) => ({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots }) as const;

  it('is still to start for a contest on a later slot of an event already under way, until that slot\'s first game', () => {
    const timing = cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, 30)), playoffs, []);

    expect(timing).toEqual({ status: SportEventStatus.SCHEDULED, startDate: new Date(NOW.getTime() + 30 * HOUR) });
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [timing], NOW)).toBe(true);
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [timing], new Date(NOW.getTime() + 30 * HOUR))).toBe(false);
  });

  it('starts at the earliest of the slots it covers on the event, and once any of them is under way, though its first game\'s time has not come', () => {
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, 50), slot('playoffs', SeasonSlotStatus.SCHEDULED, 30)), playoffs, []).startDate)
      .toEqual(new Date(NOW.getTime() + 30 * HOUR));
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.IN_PROGRESS, 30)), playoffs, []).status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('reads only the slots it covers on this event, and is the event\'s own timing where it covers none', () => {
    expect(cutoffTiming(covering(slot('another-event', SeasonSlotStatus.IN_PROGRESS, -5)), playoffs, [])).toBe(playoffs);
    expect(cutoffTiming(covering(), playoffs, [])).toBe(playoffs);
  });

  it('keeps taking entries and picks for a later round not scheduled yet on an event under way, until that round starts, rather than closing at the event\'s start', () => {
    const conferenceFinals = cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, null)), playoffs, []);

    expect(conferenceFinals).toEqual({ status: SportEventStatus.SCHEDULED, startDate: null });
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [conferenceFinals], NOW)).toBe(true);
    expect(areEventPicksOpen({ status: ContestStatus.ACTIVE }, conferenceFinals, NOW)).toBe(true);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.IN_PROGRESS, null)), playoffs, [])).toEqual({ status: SportEventStatus.IN_PROGRESS, startDate: null });
  });

  it('stands a test slot, which the sync never schedules, on its event\'s own timing, which a root admin moves by hand', () => {
    const scheduled = event('playoffs', 48, SportEventStatus.SCHEDULED);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, null, true)), scheduled, [])).toBe(scheduled);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.COMPLETED, -5, true)), scheduled, [])).toBe(scheduled);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, 30, true)), playoffs, [])).toBe(playoffs);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, 30)), playoffs, []).status).toBe(SportEventStatus.SCHEDULED);
  });

  it('leaves a cancelled slot out: it neither starts the window nor gives it its start', () => {
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.CANCELLED, -5), slot('playoffs', SeasonSlotStatus.SCHEDULED, 30)), playoffs, []))
      .toEqual({ status: SportEventStatus.SCHEDULED, startDate: new Date(NOW.getTime() + 30 * HOUR) });
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.COMPLETED, -5)), playoffs, []).status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('keeps a finished event finished, whatever its slots say', () => {
    const finished = event('playoffs', -48, SportEventStatus.COMPLETED);
    expect(cutoffTiming(covering(slot('playoffs', SeasonSlotStatus.SCHEDULED, 30)), finished, [])).toBe(finished);
  });
});

describe('cutoffTiming — a squares contest closes at its one game\'s kickoff (#711)', () => {
  const playoffs = event('playoffs', -24 * 14, SportEventStatus.IN_PROGRESS);
  const game = (id: string, startOffsetHours: number | null, status: MatchStatus = MatchStatus.SCHEDULED) => legacyMatch({
    id,
    roundNumber: 4,
    status,
    scheduledDate: startOffsetHours === null ? null : new Date(NOW.getTime() + startOffsetHours * HOUR),
  });
  const SUPER_BOWL = { kind: ContestCutoffKind.GAME_START, sportEventRoundMatchGameId: 'super-bowl-g1' } as const;

  it('closes a squares contest at its game\'s kickoff, and every other contest as before', () => {
    expect(contestCutoff({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10 }, { squaresGame: squaresGameOf('super-bowl') })).toEqual(SUPER_BOWL);
    expect(contestCutoff({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, { squaresGame: squaresGameOf('super-bowl') })).toEqual({ kind: ContestCutoffKind.FIRST_COVERED_GAME, coveredSlots: [] });
  });

  it('is not yet started, at the game\'s kickoff, while the playoffs are under way and the game is still to play', () => {
    const timing = cutoffTiming(SUPER_BOWL, playoffs, [game('conference', -24, MatchStatus.COMPLETED), game('super-bowl', 6)]);

    expect(timing).toEqual({ status: SportEventStatus.SCHEDULED, startDate: new Date(NOW.getTime() + 6 * HOUR) });
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [timing], NOW)).toBe(true);
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [timing], new Date(NOW.getTime() + 6 * HOUR))).toBe(false);
  });

  it('keeps a squares contest open until a postponed game\'s new kickoff', () => {
    const timing = cutoffTiming(SUPER_BOWL, playoffs, [game('super-bowl', 30, MatchStatus.POSTPONED)]);

    expect(timing).toEqual({ status: SportEventStatus.SCHEDULED, startDate: new Date(NOW.getTime() + 30 * HOUR) });
    expect(areContestEntriesOpen({ status: ContestStatus.OPEN }, [timing], NOW)).toBe(true);
  });

  it.each([MatchStatus.IN_PROGRESS, MatchStatus.CANCELLED])('is started once the game is %s, though its kickoff time has not passed', (status) => {
    expect(cutoffTiming(SUPER_BOWL, playoffs, [game('super-bowl', 6, status)]).status).toBe(SportEventStatus.IN_PROGRESS);
  });

  it('is started once a quarter\'s score is in, though the game is still SCHEDULED and its kickoff time has not passed', () => {
    const scored = withHomeAway(game('super-bowl', 6), { periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 0 }] });

    expect(cutoffTiming(SUPER_BOWL, playoffs, [scored]).status).toBe(SportEventStatus.IN_PROGRESS);
    expect(hasMatchStarted(scored, playoffs, NOW)).toBe(true);
  });

  it('times a game with no time of its own at the event\'s start', () => {
    expect(cutoffTiming(SUPER_BOWL, playoffs, [game('super-bowl', null)]).startDate).toEqual(playoffs.startDate);
  });

  it('closes a squares contest on a series\' Game 2 at Game 2\'s kickoff, though Game 1 has been played', () => {
    const series = game('finals', -48, MatchStatus.IN_PROGRESS);
    const [gameOne] = series.games;
    const gameTwo = { ...gameOne, id: 'finals-g2', gameNumber: 2, status: MatchStatus.SCHEDULED, scheduledDate: new Date(NOW.getTime() + 6 * HOUR), sideResults: [] };
    const timing = cutoffTiming({ kind: ContestCutoffKind.GAME_START, sportEventRoundMatchGameId: 'finals-g2' }, playoffs, [{ ...series, games: [{ ...gameOne, status: MatchStatus.COMPLETED }, gameTwo] }]);

    expect(timing).toEqual({ status: SportEventStatus.SCHEDULED, startDate: new Date(NOW.getTime() + 6 * HOUR) });
  });

  it('keeps a finished event finished, whatever its game says', () => {
    const finished = event('playoffs', -48, SportEventStatus.COMPLETED);
    expect(cutoffTiming(SUPER_BOWL, finished, [game('super-bowl', 6)])).toBe(finished);
  });
});
