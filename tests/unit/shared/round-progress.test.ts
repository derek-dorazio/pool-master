import { MatchStatus, NO_ROUND_RESULTS, ParticipantRoundStatus, RoundStatus, roundProgressOf } from '@poolmaster/shared/domain';

// Where a round stands, read off the results recorded in it (#1889): by its matches where it has
// any, otherwise by its participants' rounds.

const EARLY = new Date('2026-11-01T20:00:00.000Z');
const LATE = new Date('2026-11-01T23:00:00.000Z');

describe('roundProgressOf a round with matches', () => {
  it('is scheduled while no match has started', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.SCHEDULED, count: 4, lastCompletedAt: null }], participantRounds: [] }))
      .toEqual({ status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null });
  });

  it('is in progress once one match is under way, with no completion time yet', () => {
    expect(roundProgressOf({
      matches: [{ status: MatchStatus.IN_PROGRESS, count: 1, lastCompletedAt: null }, { status: MatchStatus.SCHEDULED, count: 3, lastCompletedAt: null }],
      participantRounds: [],
    })).toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 0, completedAt: null });
  });

  it('is in progress once some matches have results and others are still to play, counting the results', () => {
    expect(roundProgressOf({
      matches: [{ status: MatchStatus.COMPLETED, count: 2, lastCompletedAt: EARLY }, { status: MatchStatus.POSTPONED, count: 1, lastCompletedAt: null }],
      participantRounds: [],
    })).toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 2, completedAt: null });
  });

  it('is completed once every match is finished or cancelled, at the latest result\'s time', () => {
    expect(roundProgressOf({
      matches: [
        { status: MatchStatus.COMPLETED, count: 2, lastCompletedAt: LATE },
        { status: MatchStatus.CANCELLED, count: 1, lastCompletedAt: null },
      ],
      participantRounds: [{ status: ParticipantRoundStatus.IN_PROGRESS, count: 9, lastCompletedAt: null }],
    })).toEqual({ status: RoundStatus.COMPLETED, resultCount: 2, completedAt: LATE });
  });

  it('is completed with no completion time when every match was cancelled', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.CANCELLED, count: 2, lastCompletedAt: null }], participantRounds: [] }))
      .toEqual({ status: RoundStatus.COMPLETED, resultCount: 0, completedAt: null });
  });
});

describe('roundProgressOf a round without matches', () => {
  it('is scheduled with nothing recorded', () => {
    expect(roundProgressOf(NO_ROUND_RESULTS)).toEqual({ status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null });
  });

  it('is in progress while a participant round is under way, counting the finished ones', () => {
    expect(roundProgressOf({
      matches: [],
      participantRounds: [
        { status: ParticipantRoundStatus.COMPLETED, count: 40, lastCompletedAt: EARLY },
        { status: ParticipantRoundStatus.IN_PROGRESS, count: 20, lastCompletedAt: null },
      ],
    })).toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 40, completedAt: null });
  });

  it('is completed once every recorded participant round is finished, a withdrawal or cut included, at the latest one\'s time', () => {
    expect(roundProgressOf({
      matches: [],
      participantRounds: [
        { status: ParticipantRoundStatus.COMPLETED, count: 60, lastCompletedAt: LATE },
        { status: ParticipantRoundStatus.DNF, count: 1, lastCompletedAt: EARLY },
        { status: ParticipantRoundStatus.MISSED_CUT, count: 3, lastCompletedAt: null },
      ],
    })).toEqual({ status: RoundStatus.COMPLETED, resultCount: 64, completedAt: LATE });
  });
});
