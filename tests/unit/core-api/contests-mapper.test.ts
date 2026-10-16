import { ContestEntryStatus, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import { ContestLeaderboardResponseSchema } from '@poolmaster/shared/dto';
import {
  toContestLeaderboardResponse,
  toContestListResponse,
  toContestResponse,
} from '../../../packages/core-api/src/mappers/contests.mapper';
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

describe('toContestLeaderboardResponse', () => {
  it('publishes the event\'s sport, so a client can resolve the scoring family it renders the board with', () => {
    const response = toContestLeaderboardResponse({
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: Sport.GOLF,
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
      scoringDefinitionId: 'FINISH_POSITION_POINTS',
      countingRule: { type: 'BEST_N', count: 3 },
      participants: [],
      entries: [{
        entryId: 'entry-1',
        entryName: 'Paddock Pals',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Paddock Pals',
        status: ContestEntryStatus.SUBMITTED,
        score: 8,
        position: 1,
        displayPosition: '1',
        countingPickLimit: 3,
        scoredPickCount: 2,
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
  });
});
