import { toContestListResponse, toContestResponse } from '../../../packages/core-api/src/mappers/contests.mapper';
import { SelectionType, type ContestConfiguration, type ContestSelectionConfig } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';

describe('toContestResponse', () => {
  const configuration = (configJson: ContestSelectionConfig): ContestConfiguration => ({
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: configJson.selectionType,
    configJson,
    maxEntriesPerSquad: 1,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  });

  it('returns a tiered contest\'s picks per tier and counted scores, taking the entry cap from its column', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1' }),
      configuration({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }),
    );

    expect(response.contestConfiguration).toEqual({ picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 });
  });

  it('returns a budget contest\'s roster size, salary cap and counted scores', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1', selectionType: SelectionType.BUDGET_PICK }),
      configuration({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, salaryCap: 50_000, countedScores: 4 }),
    );

    expect(response.contestConfiguration).toEqual({ rosterSize: 6, salaryCap: 50_000, countedScores: 4, maxEntriesPerSquad: 1 });
  });
});

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
    expect(toContestResponse(buildContest({ id: 'contest-1', sportEventId: 'event-1' }), null).contest).not.toHaveProperty('sportEvent');
  });
});
