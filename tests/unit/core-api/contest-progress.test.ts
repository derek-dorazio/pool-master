import { ContestFormat, ContestStatus, MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { countsEventGames, describeContestProgress } from '../../../packages/core-api/src/modules/contests/contest-progress';

const live = (contestFormat: ContestFormat) => ({ contestFormat, status: ContestStatus.ACTIVE });
const events = (...statuses: SportEventStatus[]) => statuses.map((status) => ({ status }));
const games = (...statuses: MatchStatus[]) => statuses.map((status) => ({ status }));

describe('describeContestProgress', () => {
  it('counts a pick\'em or survivor season in weeks played, leaving a cancelled week out of both sides', () => {
    expect(describeContestProgress(live(ContestFormat.PREDICTION), events(SportEventStatus.COMPLETED, SportEventStatus.CANCELLED, SportEventStatus.IN_PROGRESS, SportEventStatus.SCHEDULED), []))
      .toEqual({ played: 1, total: 3, unit: 'WEEKS' });
  });

  it('counts a roster contest of several events in events played', () => {
    expect(describeContestProgress(live(ContestFormat.ROSTER), events(SportEventStatus.COMPLETED, SportEventStatus.IN_PROGRESS), []))
      .toEqual({ played: 1, total: 2, unit: 'EVENTS' });
  });

  it('counts a one-event pick\'em in its games played, leaving cancelled games out', () => {
    expect(describeContestProgress(live(ContestFormat.PREDICTION), events(SportEventStatus.IN_PROGRESS), games(MatchStatus.COMPLETED, MatchStatus.COMPLETED, MatchStatus.IN_PROGRESS, MatchStatus.CANCELLED)))
      .toEqual({ played: 2, total: 3, unit: 'GAMES' });
  });

  it('gives no progress to a one-event pick\'em with fewer than two games to count, or to a one-event roster contest', () => {
    expect(describeContestProgress(live(ContestFormat.PREDICTION), events(SportEventStatus.IN_PROGRESS), games(MatchStatus.IN_PROGRESS, MatchStatus.CANCELLED))).toBeNull();
    expect(describeContestProgress(live(ContestFormat.ROSTER), events(SportEventStatus.IN_PROGRESS), [])).toBeNull();
  });

  it('gives no progress to a contest that is not live', () => {
    for (const status of [ContestStatus.DRAFT, ContestStatus.OPEN, ContestStatus.COMPLETED]) {
      expect(describeContestProgress({ contestFormat: ContestFormat.PREDICTION, status }, events(SportEventStatus.COMPLETED, SportEventStatus.SCHEDULED), [])).toBeNull();
    }
  });
});

describe('countsEventGames', () => {
  it('reads games only for a live prediction contest of one event', () => {
    expect(countsEventGames({ ...live(ContestFormat.PREDICTION), sportEventIds: ['week-12'] })).toBe(true);
    expect(countsEventGames({ ...live(ContestFormat.PREDICTION), sportEventIds: ['w1', 'w2'] })).toBe(false);
    expect(countsEventGames({ ...live(ContestFormat.ROSTER), sportEventIds: ['masters'] })).toBe(false);
    expect(countsEventGames({ contestFormat: ContestFormat.PREDICTION, status: ContestStatus.OPEN, sportEventIds: ['week-12'] })).toBe(false);
  });
});
