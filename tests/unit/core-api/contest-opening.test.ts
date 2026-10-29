/**
 * Whether Create contest would take a setup on an event now (#1007), as the event pages ask it:
 * open, not yet (unreleased, no field, a later-round bracket's teams unknown), or closed (past
 * the setup's cutoff).
 */
import { SelectionType, SportEventStatus, Sport, TournamentFormat } from '@poolmaster/shared/domain';
import {
  ContestOpening,
  contestOpening,
  type ContestOpeningReader,
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
    sport: Sport.AMERICAN_FOOTBALL,
    sportLeagueId: 'league-1',
    eventYear: 2027,
    tournamentFormat: TournamentFormat.MATCHES,
    participantCount: null,
    loadedParticipantCount: 14,
    rounds: 4,
    salaryCap: null,
    squaresFromRound: null,
    ...overrides,
  };
}

function reader(sportEvent: ContestCreateSportEventState | null, options: {
  roundStart?: { status: SportEventStatus; startDate: Date };
  bracketProblem?: string | null;
  squaresKickoff?: Date | null;
} = {}): ContestOpeningReader {
  return {
    findById: jest.fn().mockResolvedValue(sportEvent),
    findCutoffTiming: jest.fn().mockImplementation((state: ContestCreateSportEventState, cutoff: { kind: string }) =>
      Promise.resolve(cutoff.kind === 'ROUND_START' ? options.roundStart ?? state : state)),
    findBracketProblem: jest.fn().mockResolvedValue(options.bracketProblem ?? null),
    nextSquaresKickoff: jest.fn().mockResolvedValue(options.squaresKickoff === undefined ? LATER : options.squaresKickoff),
  };
}

const TIERED = { selectionType: SelectionType.TIERED, startsAtRound: null };
const BRACKET_FROM_ROUND_3 = { selectionType: SelectionType.BRACKET, startsAtRound: 3 };
const SQUARES = { selectionType: SelectionType.SQUARES, startsAtRound: null };

describe('contestOpening', () => {
  it('is OPEN for a released event with its field loaded that has not started', async () => {
    expect((await contestOpening(reader(event()), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.OPEN);
  });

  it('is NOT_YET for an event still in DRAFT, so its card shows when it opens', async () => {
    expect((await contestOpening(reader(event({ status: SportEventStatus.DRAFT })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.NOT_YET);
  });

  it('is NOT_YET for a released event whose field has not loaded', async () => {
    expect((await contestOpening(reader(event({ loadedParticipantCount: 0 })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.NOT_YET);
  });

  it('is CLOSED for an event that has started, even unreleased, so the page leaves the offer out', async () => {
    expect((await contestOpening(reader(event({ startDate: EARLIER })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
    expect((await contestOpening(reader(event({ status: SportEventStatus.DRAFT, startDate: EARLIER })), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('is CLOSED for an event that no longer exists', async () => {
    expect((await contestOpening(reader(null), 'event-1', TIERED, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('is OPEN for a later-round bracket on a knockout under way whose starting round is ahead and set', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    const opening = await contestOpening(reader(underWay, { roundStart: { status: SportEventStatus.SCHEDULED, startDate: LATER } }), 'event-1', BRACKET_FROM_ROUND_3, NOW);
    expect(opening.opening).toBe(ContestOpening.OPEN);
  });

  it('is NOT_YET for a later-round bracket whose starting round\'s teams are not set', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    const opening = await contestOpening(
      reader(underWay, { roundStart: { status: SportEventStatus.SCHEDULED, startDate: LATER }, bracketProblem: 'round 3 has a game with a team to be decided' }),
      'event-1', BRACKET_FROM_ROUND_3, NOW,
    );
    expect(opening.opening).toBe(ContestOpening.NOT_YET);
  });

  it('is CLOSED for a later-round bracket once its starting round has kicked off', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    const opening = await contestOpening(reader(underWay, { roundStart: { status: SportEventStatus.IN_PROGRESS, startDate: EARLIER } }), 'event-1', BRACKET_FROM_ROUND_3, NOW);
    expect(opening.opening).toBe(ContestOpening.CLOSED);
  });

  it('is OPEN for squares on an event under way while one of its games is still ahead, and CLOSED once none is', async () => {
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });
    expect((await contestOpening(reader(underWay, { squaresKickoff: LATER }), 'event-1', SQUARES, NOW)).opening).toBe(ContestOpening.OPEN);
    expect((await contestOpening(reader(underWay, { squaresKickoff: null }), 'event-1', SQUARES, NOW)).opening).toBe(ContestOpening.CLOSED);
  });

  it('says when the setup closes: the event\'s start, a later-round bracket\'s round start, the next squares kickoff; none once CLOSED (#1181)', async () => {
    const roundStart = new Date('2027-01-17T18:00:00.000Z');
    const kickoff = new Date('2027-01-11T01:15:00.000Z');
    const underWay = event({ status: SportEventStatus.IN_PROGRESS, startDate: EARLIER });

    expect(await contestOpening(reader(event({ status: SportEventStatus.DRAFT })), 'event-1', TIERED, NOW))
      .toEqual({ opening: ContestOpening.NOT_YET, closesAt: LATER });
    expect((await contestOpening(reader(underWay, { roundStart: { status: SportEventStatus.SCHEDULED, startDate: roundStart } }), 'event-1', BRACKET_FROM_ROUND_3, NOW)).closesAt)
      .toEqual(roundStart);
    expect((await contestOpening(reader(underWay, { squaresKickoff: kickoff }), 'event-1', SQUARES, NOW)).closesAt).toEqual(kickoff);
    expect(await contestOpening(reader(event({ startDate: EARLIER })), 'event-1', TIERED, NOW)).toEqual({ opening: ContestOpening.CLOSED, closesAt: null });
  });
});
