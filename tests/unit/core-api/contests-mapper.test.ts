import { toContestResponse } from '../../../packages/core-api/src/mappers/contests.mapper';
import { SelectionType, type ContestConfiguration } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';

describe('toContestResponse', () => {
  it('returns only the typed settings of a configuration saved with extra keys, taking the entry cap from its column', () => {
    // A row written before #416 kept the whole request in configJson, a lock time and a stale
    // entry cap included.
    const legacyConfigJson = {
      rosterSize: 6,
      countedScores: 4,
      locksAt: '2026-04-10T12:00:00.000Z',
      maxEntriesPerSquad: 9,
    };
    const configuration: ContestConfiguration = {
      id: 'config-1',
      contestId: 'contest-1',
      selectionType: SelectionType.TIERED,
      configJson: legacyConfigJson,
      maxEntriesPerSquad: 1,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    };

    const response = toContestResponse(buildContest({ id: 'contest-1' }), configuration);

    expect(response.contestConfiguration).toEqual({
      rosterSize: 6,
      countedScores: 4,
      maxEntriesPerSquad: 1,
    });
  });
});
