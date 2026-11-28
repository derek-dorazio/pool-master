/**
 * Whether Create contest would take a setup on an event now (#1007), as the event pages ask it:
 * open, not yet (unreleased, no field, a bracket's teams unknown), or closed (past the setup's
 * cutoff).
 */
import { sportEventSlots, sportPlay } from '../../support/sport-play';
import { ContestOpening, ContestOpeningReason, SelectionType, SportEventStatus, Sport } from '@poolmaster/shared/domain';
import {
  contestOpening,
  eventContestOpenings,
  eventOpening,
  type ContestOpeningReader,
  type EventContestOpening,
  type EventOpeningFacts,
} from '../../../packages/core-api/src/modules/contest-management/contest-opening';
import type { ContestCreateSportEventState } from '../../../packages/core-api/src/modules/contest-management/service';

const NOW = new Date('2027-01-10T12:00:00.000Z');
const LATER = new Date('2027-01-24T20:00:00.000Z');
const EARLIER = new Date('2027-01-09T18:00:00.000Z');

function event(overrides: Partial<ContestCreateSportEventState> = {}): ContestCreateSportEventState {
  return {
    id: 'event-1',
    status: SportEventStatus.SCHEDULED,
    startDate: LATER,
    sport: Sport.FOOTBALL,
    sportLeagueId: 'league-1',
    sportLeagueSeasonId: 'season-2027',
    championshipYear: 2027,
    playsMatches: true,
    participantCount: 14,
    rounds: 4,
    slotDefinitionIds: [],
    playsOnlyKnockoutRounds: true,
    ...sportPlay(overrides.sport ?? Sport.FOOTBALL),
    ...overrides,
  };
}

function reader(sportEvent: ContestCreateSportEventState | null, options: {
  bracketProblem?: string | null;
  squaresKickoff?: Date | null;
} = {}): ContestOpeningReader {
  return {
    findById: jest.fn().mockResolvedValue(sportEvent),
    findBracketProblem: jest.fn().mockResolvedValue(options.bracketProblem ?? null),
    nextSquaresKickoff: jest.fn().mockResolvedValue(options.squaresKickoff === undefined ? LATER : options.squaresKickoff),
  };
}

const TIERED = { selectionType: SelectionType.TIERED };
const BRACKET = { selectionType: SelectionType.BRACKET };
const SQUARES = { selectionType: SelectionType.SQUARES };

describe('contestOpening', () => {
  it('is OPEN for a released event with its field loaded that has not started', async () => {
    expect((await contestOpening(reader(event()), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.OPEN);
  });

  it('is NOT_YET for an event still in DRAFT, so its card shows when it opens', async () => {
    expect((await contestOpening(reader(event({ status: SportEventStatus.DRAFT })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.NOT_YET);
  });

  it('is NOT_YET for a released event whose field has not loaded', async () => {
    expect((await contestOpening(reader(event({ participantCount: 0 })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.NOT_YET);
  });

  it('is CLOSED for an event that has started, even unreleased, so the page leaves the offer out', async () => {
    expect((await contestOpening(reader(event({ startDate: EARLIER })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
    expect((await contestOpening(reader(event({ status: SportEventStatus.DRAFT, startDate: EARLIER })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('is CLOSED for an event that no longer exists', async () => {
    expect((await contestOpening(reader(null), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('is NOT_YET for a bracket whose teams are not set, and CLOSED for one on a knockout under way', async () => {
    expect((await contestOpening(reader(event(), { bracketProblem: 'round 1 has a game with a team to be decided' }), 'event-1', BRACKET, NOW)).opening)
      .toBe(ContestOpening.NOT_YET);
    expect((await contestOpening(reader(event()), 'event-1', BRACKET, NOW)).opening).toBe(ContestOpening.OPEN);
    expect((await contestOpening(reader(event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER })), 'event-1', BRACKET, NOW)).opening)
      .toBe(ContestOpening.CLOSED);
  });

  it('is OPEN for squares on an event under way while one of its games is still ahead, and CLOSED once none is', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    expect((await contestOpening(reader(underWay, { squaresKickoff: LATER }), 'event-1', SQUARES, NOW)).opening).toBe(ContestOpening.OPEN);
    expect((await contestOpening(reader(underWay, { squaresKickoff: null }), 'event-1', SQUARES, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('says when the setup closes: the event\'s start, the next squares kickoff; none once CLOSED (#1181)', async () => {
    const kickoff = new Date('2027-01-11T01:15:00.000Z');
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });

    expect(await contestOpening(reader(event({ status: SportEventStatus.DRAFT })), 'event-1', TIERED, NOW))
      .toEqual({ opening: ContestOpening.NOT_YET, reason: ContestOpeningReason.EVENT_NOT_RELEASED, closesAt: LATER });
    expect((await contestOpening(reader(event()), 'event-1', BRACKET, NOW)).closesAt).toEqual(LATER);
    expect((await contestOpening(reader(underWay, { squaresKickoff: kickoff }), 'event-1', SQUARES, NOW)).closesAt).toEqual(kickoff);
    expect(await contestOpening(reader(event({ startDate: EARLIER })), 'event-1', TIERED, NOW)).toEqual({ opening: ContestOpening.CLOSED, reason: ContestOpeningReason.EVENT_STARTED, closesAt: null });
  });
});

describe('contestOpening\'s reason for each wait and close (#2015)', () => {
  const reasonOf = async (sportEvent: ContestCreateSportEventState | null, setup: { selectionType: SelectionType }, options: Parameters<typeof reader>[1] = {}) =>
    (await contestOpening(reader(sportEvent, options), 'event-1', setup, NOW)).reason;

  it('names the wait: release first, then the field, then a bracket\'s teams', async () => {
    expect(await reasonOf(event({ status: SportEventStatus.DRAFT, participantCount: 0 }), TIERED)).toBe(ContestOpeningReason.EVENT_NOT_RELEASED);
    expect(await reasonOf(event({ participantCount: 0 }), TIERED)).toBe(ContestOpeningReason.FIELD_NOT_LOADED);
    expect(await reasonOf(event(), BRACKET, { bracketProblem: 'a team to be decided' })).toBe(ContestOpeningReason.BRACKET_NOT_SET);
  });

  it('names the close: the event under way, or squares with every game kicked off', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    expect(await reasonOf(underWay, TIERED)).toBe(ContestOpeningReason.EVENT_STARTED);
    expect(await reasonOf(underWay, SQUARES, { squaresKickoff: null })).toBe(ContestOpeningReason.NO_GAME_LEFT);
    expect(await reasonOf(null, TIERED)).toBe(ContestOpeningReason.EVENT_STARTED);
  });

  it('gives no reason for an open setup', async () => {
    expect(await reasonOf(event(), TIERED)).toBeNull();
  });
});

describe('contestOpening starts from the event-level rule (#1932)', () => {
  const EVENTS: Array<[string, ContestCreateSportEventState]> = [
    ['ready', event()],
    ['a draft', event({ status: SportEventStatus.DRAFT })],
    ['without its field', event({ participantCount: 0 })],
    ['past its start', event({ startDate: EARLIER })],
    ['a knockout under way', event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER })],
    ['a draft past its start', event({ status: SportEventStatus.DRAFT, startDate: EARLIER })],
    ['over', event({ status: SportEventStatus.COMPLETED, startDate: EARLIER })],
  ];
  const SETUPS = Object.values(SelectionType).map((selectionType) => ({ selectionType }));

  it.each(EVENTS)('for an event %s, every setup is CLOSED or NOT_YET whenever the event-level row is, with its reason, and OPEN where it is and its own checks pass', async (_name, sportEvent) => {
    for (const setup of SETUPS) {
      const row = eventOpening(sportEvent, setup.selectionType, NOW);
      const window = await contestOpening(reader(sportEvent), 'event-1', setup, NOW);
      if (row.opening === ContestOpening.OPEN) {
        // With its own checks passing (a squares game ahead, the bracket set), an OPEN row stays OPEN.
        expect([setup.selectionType, window.opening]).toEqual([setup.selectionType, ContestOpening.OPEN]);
      } else {
        expect([setup.selectionType, window.opening, window.reason]).toEqual([setup.selectionType, row.opening, row.reason]);
      }
    }
  });

  it('agrees with the event list\'s row for squares on a knockout with no game left only by narrowing it: OPEN in the list, CLOSED on create', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    expect(eventOpening(underWay, SelectionType.SQUARES, NOW).opening).toBe(ContestOpening.OPEN);
    expect((await contestOpening(reader(underWay, { squaresKickoff: null }), 'event-1', SQUARES, NOW)).opening).toBe(ContestOpening.CLOSED);
  });
});

describe('eventContestOpenings, the event list\'s openings per selection type (#1929)', () => {
  function facts(overrides: Partial<EventOpeningFacts> = {}): EventOpeningFacts {
    return { sport: Sport.BASKETBALL, status: SportEventStatus.SCHEDULED, startDate: LATER, participantCount: 64, ...sportPlay(overrides.sport ?? Sport.BASKETBALL), slotDefinitions: sportEventSlots(overrides.sport ?? Sport.BASKETBALL), ...overrides };
  }
  const byType = (rows: EventContestOpening[]) => Object.fromEntries(rows.map((row) => [row.selectionType, row])) as Record<SelectionType, EventContestOpening>;

  it('opens every format basketball offers on a contest-ready event', () => {
    const rows = eventContestOpenings(facts(), NOW);
    expect(rows.map((row) => row.selectionType)).toEqual(['TIERED', 'BUDGET_PICK', 'RANDOM_DRAW', 'PICK_EM', 'BRACKET', 'SURVIVOR', 'SQUARES']);
    expect(rows.every((row) => row.opening === ContestOpening.OPEN)).toBe(true);
  });

  it('is NOT_YET for every format while the event is a draft or has no field', () => {
    for (const notReady of [facts({ status: SportEventStatus.DRAFT }), facts({ participantCount: 0 })]) {
      expect(eventContestOpenings(notReady, NOW).every((row) => row.opening === ContestOpening.NOT_YET)).toBe(true);
    }
  });

  it('keeps a knockout under way open to squares alone, closing every other format, a bracket included', () => {
    const rows = byType(eventContestOpenings(facts({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER }), NOW));
    expect(rows.BRACKET).toEqual({ selectionType: 'BRACKET', opening: 'CLOSED', reason: 'EVENT_STARTED' });
    expect(rows.SQUARES.opening).toBe(ContestOpening.OPEN);
    expect(rows.TIERED.opening).toBe(ContestOpening.CLOSED);
    expect(rows.PICK_EM.opening).toBe(ContestOpening.CLOSED);
  });

  it('closes everything on a finished knockout, on a knockout whose start passed before it moved to in progress, and on a golf event under way', () => {
    const closed = (rows: ReturnType<typeof eventContestOpenings>) => rows.every((row) => row.opening === ContestOpening.CLOSED);
    expect(closed(eventContestOpenings(facts({ status: SportEventStatus.COMPLETED, startDate: EARLIER }), NOW))).toBe(true);
    expect(closed(eventContestOpenings(facts({ startDate: EARLIER }), NOW))).toBe(true);
    expect(closed(eventContestOpenings(facts({ sport: Sport.GOLF, status: SportEventStatus.IN_PROGRESS, startDate: EARLIER }), NOW))).toBe(true);
  });
});
