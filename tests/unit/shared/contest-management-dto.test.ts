import {
  ContestConfigurationRequestSchema,
  CreateContestManagementRequestSchema,
} from '../../../packages/shared/dto';

describe('contest-management dto schemas', () => {
  it('accepts a launch-shape contest configuration with participant scoring, aggregation, and prize definitions', () => {
    const parsed = CreateContestManagementRequestSchema.parse({
      name: 'Masters Pick 6',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      configuration: {
        selectionType: 'BUDGET_PICK',
        locksAt: '2026-04-10T12:00:00.000Z',
        minimumEntries: 2,
        maxEntriesPerSquad: 3,
        rosterSize: 6,
        totalPrizePoolAmount: 500,
        participantScoringRules: [
          {
            participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
            sortOrder: 1,
            config: { missedCutPenalty: 10 },
            active: true,
          },
        ],
        entryAggregationRule: {
          aggregationDefinitionId: 'SUM_TOP_N_ENTRIES',
          config: { topN: 4, lowerIsBetter: true },
          active: true,
        },
        prizeDefinitions: [
          {
            prizeDefinitionId: 'FINAL_PLACE',
            displayName: 'First Place',
            sortOrder: 1,
            ruleConfig: { place: 1 },
            payoutType: 'PERCENTAGE',
            percentage: 50,
            active: true,
          },
        ],
      },
    });

    expect(parsed.configuration.participantScoringRules).toHaveLength(1);
    expect(parsed.configuration.entryAggregationRule.aggregationDefinitionId).toBe(
      'SUM_TOP_N_ENTRIES',
    );
  });

  it('rejects unsupported selection types for first-pass contest management configuration', () => {
    expect(() =>
      ContestConfigurationRequestSchema.parse({
        selectionType: 'PICK_EM',
        participantScoringRules: [],
        entryAggregationRule: {
          aggregationDefinitionId: 'SUM_ALL_ENTRIES',
          config: {},
          active: true,
        },
      }),
    ).toThrow();
  });
});
