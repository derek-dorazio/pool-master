import { toContestResponse } from '../../../packages/core-api/src/mappers/contests.mapper';
import { SelectionType, type ContestConfiguration, type ContestSelectionConfig } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';

describe('toContestResponse', () => {
  const configuration = (
    configJson: ContestSelectionConfig,
    maxEntriesPerSquad: number | null = 1,
  ): ContestConfiguration => ({
    id: 'config-1',
    contestId: 'contest-1',
    selectionType: configJson.selectionType,
    configJson,
    maxEntriesPerSquad,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
  });

  it('returns a tiered contest\'s rules tagged TIERED, with picks per tier, counted scores and the entry cap from its column', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1' }),
      configuration({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }),
    );

    expect(response.contestConfiguration).toEqual({
      selectionType: SelectionType.TIERED,
      picksPerTier: 1,
      countedScores: 4,
      maxEntriesPerSquad: 1,
    });
  });

  it('returns a budget contest\'s rules tagged BUDGET_PICK, with roster size, salary cap and counted scores', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1', selectionType: SelectionType.BUDGET_PICK }),
      configuration({ selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, salaryCap: 50_000, countedScores: 4 }),
    );

    expect(response.contestConfiguration).toEqual({
      selectionType: SelectionType.BUDGET_PICK,
      rosterSize: 6,
      salaryCap: 50_000,
      countedScores: 4,
      maxEntriesPerSquad: 1,
    });
  });

  it('reports a missing entries-per-team limit as null, meaning unlimited', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1' }),
      configuration({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 }, null),
    );

    expect(response.contestConfiguration?.maxEntriesPerSquad).toBeNull();
  });

  it('returns no rules for a contest whose configuration has none, such as a selection type without a rules shape', () => {
    const response = toContestResponse(
      buildContest({ id: 'contest-1', selectionType: SelectionType.SNAKE_DRAFT }),
      {
        id: 'config-1',
        contestId: 'contest-1',
        selectionType: SelectionType.SNAKE_DRAFT,
        maxEntriesPerSquad: 1,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    );

    expect(response.contestConfiguration).toBeNull();
  });

  it('returns no rules for a contest with no configuration', () => {
    expect(toContestResponse(buildContest({ id: 'contest-1' }), null).contestConfiguration).toBeNull();
  });
});
