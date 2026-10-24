import { expect } from '@jest/globals';
import { ScoringFamily, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import {
  toContestLeaderboardResponse,
  toContestListResponse,
  toContestResponse,
} from '../../../packages/core-api/src/mappers/contests.mapper';
import { buildContest } from '../../factories';

describe('toContestListResponse', () => {
  const masters = {
    id: 'event-1',
    name: 'The Masters',
    startDate: new Date('2026-04-09T12:40:00.000Z'),
    status: SportEventStatus.SCHEDULED,
  };
  const pga = {
    id: 'event-2',
    name: 'PGA Championship',
    startDate: new Date('2026-05-14T12:00:00.000Z'),
    status: SportEventStatus.SCHEDULED,
  };

  it('gives each listed contest its entry count and its event\'s id, sequence, name, start and status', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'contest-1', sportEventIds: ['event-1'] })],
      new Map([['contest-1', 3]]),
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]).toMatchObject({
      entryCount: 3,
      sportEvents: [{
        sportEventId: 'event-1',
        sequence: 1,
        name: 'The Masters',
        startDate: '2026-04-09T12:40:00.000Z',
        status: SportEventStatus.SCHEDULED,
      }],
    });
  });

  it('lists a multi-event contest\'s events in its sequence order, numbered from 1', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'majors', sportEventIds: ['event-1', 'event-2'] })],
      new Map(),
      new Map([['event-2', pga], ['event-1', masters]]),
    );

    expect(response.contests[0]?.sportEvents.map((event) => [event.sequence, event.name]))
      .toEqual([[1, 'The Masters'], [2, 'PGA Championship']]);
  });

  it('leaves an event that was not found out of the contest\'s events rather than inventing one', () => {
    const response = toContestListResponse(
      [buildContest({ id: 'lost-event', sportEventIds: ['event-gone'] })],
      new Map(),
      new Map([['event-1', masters]]),
    );

    expect(response.contests[0]?.sportEvents).toEqual([]);
  });
});

describe('toContestResponse events', () => {
  it('gives a single-contest read its events too, so a page reads each event\'s name and status from it', () => {
    expect(toContestResponse(buildContest({ id: 'contest-1', sportEventIds: ['event-1'] }), new Map([['event-1', masters()]])).contest.sportEvents)
      .toEqual([expect.objectContaining({ sportEventId: 'event-1', name: 'The Masters' })]);
  });

  function masters() {
    return { id: 'event-1', name: 'The Masters', startDate: new Date('2026-04-09T12:40:00.000Z'), status: SportEventStatus.SCHEDULED };
  }
});

describe('toContestLeaderboardResponse', () => {
  it('publishes the event\'s sport, so a client can resolve the scoring family it renders the board with', () => {
    const response = toContestLeaderboardResponse({
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: Sport.GOLF,
      scoringFamily: ScoringFamily.STROKE_PLAY,
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 4 },
      participants: [],
      entries: [],
      asOf: null,
    });

    expect(response.sport).toBe(Sport.GOLF);
    expect(ContestLeaderboardResponseSchema.parse(response).sport).toBe(Sport.GOLF);
  });

  it('publishes a horse racing entry\'s total as its totalScore and each pick\'s points on the race block, leaving the golf one null', () => {
    const response = toContestLeaderboardResponse({
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: Sport.HORSE_RACING,
      scoringFamily: ScoringFamily.FINISH_POSITION,
      scoringDefinitionId: 'FINISH_POSITION_POINTS',
      countingRule: { type: 'BEST_N', count: 3 },
      participants: [],
      entries: [{
        entryId: 'entry-1',
        entryName: 'Paddock Pals',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Paddock Pals',
        score: 8,
        position: 1,
        displayPosition: '1',
        countingPickLimit: 3,
        scoredPickCount: 2,
        events: [{ sportEventId: 'event-1', score: 8, position: 1, displayPosition: '1' }],
        picks: [{
          pickId: 'pick-1',
          sportEventParticipantId: 'sep-1',
          pickedAt: new Date('2026-05-01T12:00:00.000Z'),
          slot: 1,
          isCounting: true,
          isDropped: false,
          participant: {
            sportEventParticipantId: 'sep-1',
            name: 'Arrow',
            score: 5,
            detail: { scoringFamily: ScoringFamily.FINISH_POSITION },
            asOf: null,
          },
        }],
      }],
      asOf: null,
    });

    const [entry] = ContestLeaderboardResponseSchema.parse(response).entries;
    expect(entry.totalScore).toBe(8);
    expect([entry.picks[0].golf, entry.picks[0].race]).toEqual([null, { points: 5 }]);
    expect(entry.events).toEqual([{ sportEventId: 'event-1', totalScore: 8, position: 1, displayPosition: '1' }]);
  });
});
