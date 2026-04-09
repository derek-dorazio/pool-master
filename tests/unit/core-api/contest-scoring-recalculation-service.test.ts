import { ContestScoringRecalculationService } from '../../../packages/core-api/src/modules/contest-scoring';

describe('ContestScoringRecalculationService', () => {
  it('scores entries, assigns ranks, and applies FINAL_PLACE awards', async () => {
    const replaceEntryScoringResult = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      contest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'contest-1',
          configuration: {
            participantScoringRules: [
              {
                id: 'rule-team-win',
                participantScoringDefinitionId: 'TEAM_WIN_POINTS',
                sortOrder: 1,
                config: { pointsPerWin: 1 },
                active: true,
              },
              {
                id: 'rule-round',
                participantScoringDefinitionId: 'ROUND_MULTIPLIER',
                sortOrder: 2,
                config: { roundMultipliers: { '2': 2 } },
                active: true,
              },
              {
                id: 'rule-seed',
                participantScoringDefinitionId: 'SEED_DIFFERENTIAL_BONUS',
                sortOrder: 3,
                config: { underdogOnly: true },
                active: true,
              },
            ],
            entryAggregationRule: {
              id: 'agg-1',
              aggregationDefinitionId: 'SUM_ALL_ENTRIES',
              config: {},
              active: true,
            },
            prizeDefinitions: [
              {
                id: 'prize-1',
                prizeDefinitionId: 'FINAL_PLACE',
                displayName: 'Champion',
                sortOrder: 1,
                ruleConfig: { place: 1 },
                payoutType: 'FIXED_AMOUNT',
                amount: 100,
                percentage: null,
                active: true,
              },
            ],
          },
          entries: [
            {
              id: 'entry-1',
              totalScore: 0,
              standingsPosition: 2,
              rosterPicks: [
                {
                  id: 'pick-1',
                  sportEventParticipantId: 'sep-1',
                  sportEventParticipant: {
                    sourceData: [
                      {
                        rawPayload: {},
                        normalizedData: {
                          completedWins: [{ round: 2, seed: 10, opponentSeed: 2 }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              id: 'entry-2',
              totalScore: 0,
              standingsPosition: 1,
              rosterPicks: [
                {
                  id: 'pick-2',
                  sportEventParticipantId: 'sep-2',
                  sportEventParticipant: {
                    sourceData: [
                      {
                        rawPayload: {},
                        normalizedData: {
                          completedWins: [{ round: 1, seed: 2, opponentSeed: 10 }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }),
      },
    } as any;

    const service = new ContestScoringRecalculationService(prisma);
    (service as any).entryScoringResultService = {
      replaceEntryScoringResult,
    };

    const result = await service.recalculateContest('contest-1');

    expect(result.contestId).toBe('contest-1');
    expect(result.teamsAffected).toBe(2);
    expect(replaceEntryScoringResult).toHaveBeenCalledTimes(2);
    expect(replaceEntryScoringResult).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-1',
        totalScore: 11,
        standingsPosition: 1,
        prizeAwards: [
          expect.objectContaining({
            contestPrizeDefinitionId: 'prize-1',
            displayName: 'Champion',
            amount: 100,
          }),
        ],
      }),
    );
    expect(replaceEntryScoringResult).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-2',
        totalScore: 1,
        standingsPosition: 2,
        prizeAwards: [],
      }),
    );
  });
});
