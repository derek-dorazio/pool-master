import { toContestResponse } from '../../../packages/core-api/src/mappers/contests.mapper';
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
