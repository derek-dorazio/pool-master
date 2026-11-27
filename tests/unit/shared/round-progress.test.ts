import { MatchStatus, NO_ROUND_RESULTS, RoundStatus, roundProgressOf } from '@poolmaster/shared/domain';

// Where a round stands, read off the results recorded in it (#1889): by its matches. A golf round
// or a race is one FIELD match (#2008).

const EARLY = new Date('2026-11-01T20:00:00.000Z');
const LATE = new Date('2026-11-01T23:00:00.000Z');

describe('roundProgressOf a round with matches', () => {
  it('is scheduled while no match has started', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.SCHEDULED, count: 4, lastCompletedAt: null }] }))
      .toEqual({ status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null });
  });

  it('is in progress once one match is under way, with no completion time yet', () => {
    expect(roundProgressOf({
      matches: [{ status: MatchStatus.IN_PROGRESS, count: 1, lastCompletedAt: null }, { status: MatchStatus.SCHEDULED, count: 3, lastCompletedAt: null }],
    })).toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 0, completedAt: null });
  });

  it('is in progress once some matches have results and others are still to play, counting the results', () => {
    expect(roundProgressOf({
      matches: [{ status: MatchStatus.COMPLETED, count: 2, lastCompletedAt: EARLY }, { status: MatchStatus.POSTPONED, count: 1, lastCompletedAt: null }],
    })).toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 2, completedAt: null });
  });

  it('is completed once every match is finished or cancelled, at the latest result\'s time', () => {
    expect(roundProgressOf({
      matches: [
        { status: MatchStatus.COMPLETED, count: 2, lastCompletedAt: LATE },
        { status: MatchStatus.CANCELLED, count: 1, lastCompletedAt: null },
      ],
    })).toEqual({ status: RoundStatus.COMPLETED, resultCount: 2, completedAt: LATE });
  });

  it('is completed with no completion time when every match was cancelled', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.CANCELLED, count: 2, lastCompletedAt: null }] }))
      .toEqual({ status: RoundStatus.COMPLETED, resultCount: 0, completedAt: null });
  });
});

describe('roundProgressOf a round without matches', () => {
  it('is scheduled with nothing recorded', () => {
    expect(roundProgressOf(NO_ROUND_RESULTS)).toEqual({ status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null });
  });
});

describe('roundProgressOf a golf round, its one FIELD match', () => {
  it('is in progress while any golfer in it is on the course', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.IN_PROGRESS, count: 1, lastCompletedAt: null }] }))
      .toEqual({ status: RoundStatus.IN_PROGRESS, resultCount: 0, completedAt: null });
  });

  it('is completed once its Game is, at the Game\'s completion time', () => {
    expect(roundProgressOf({ matches: [{ status: MatchStatus.COMPLETED, count: 1, lastCompletedAt: LATE }] }))
      .toEqual({ status: RoundStatus.COMPLETED, resultCount: 1, completedAt: LATE });
  });
});
