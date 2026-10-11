import { toContestListResponse, toContestResponse } from '../../../packages/core-api/src/mappers/contests.mapper';
import { buildContest } from '../../factories';

describe('toContestListResponse', () => {
  const masters = { name: 'The Masters', startDate: new Date('2026-04-09T12:40:00.000Z') };

  it('gives each listed contest its entry count and its event\'s name and start', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'contest-1', sportEventId: 'event-1' })],
      new Map([['contest-1', 3]]),
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]).toMatchObject({
      entryCount: 3,
      sportEvent: { name: 'The Masters', startDate: '2026-04-09T12:40:00.000Z' },
    });
  });

  it('lists a contest with no event, or one whose event was not found, with a null event', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'no-event', sportEventId: undefined }), buildContest({ id: 'lost-event', sportEventId: 'event-gone' })],
      new Map(),
      new Map([['event-1', masters]]),
    );

    expect(response.contests.map((contest) => contest.sportEvent)).toEqual([null, null]);
  });
});

describe('toContestResponse event summary', () => {
  it('leaves the event summary off a single-contest read, whose page reads the event itself', () => {
    expect(toContestResponse(buildContest({ id: 'contest-1', sportEventId: 'event-1' })).contest).not.toHaveProperty('sportEvent');
  });
});
