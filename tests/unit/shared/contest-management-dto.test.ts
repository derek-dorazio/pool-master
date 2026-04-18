import {
  ContestConfigurationRequestSchema,
  CreateContestManagementRequestSchema,
} from '../../../packages/shared/dto';

describe('contest-management dto schemas', () => {
  it('accepts a golf tiered contest configuration', () => {
    const parsed = CreateContestManagementRequestSchema.parse({
      name: 'Masters Pick 6',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestType: 'SINGLE_EVENT',
      configuration: {
        mode: 'GOLF_TIERED',
        locksAt: '2026-04-10T12:00:00.000Z',
        maxEntriesPerSquad: 3,
        rosterSize: 6,
        countedScores: 4,
        tierSource: 'ODDS',
        tierGeneration: {
          defaultTierSize: 10,
        },
        tiers: [
          {
            tierKey: 'A',
            label: 'Tier A',
            pickCount: 1,
            startPosition: 1,
            endPosition: 10,
          },
        ],
        cutRule: {
          type: 'FIXED_SCORE',
          fixedScore: 80,
        },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: {
          type: 'PREDICT_WINNING_SCORE',
        },
      },
    });

    expect(parsed.configuration.mode).toBe('GOLF_TIERED');
    if (parsed.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(parsed.configuration.tiers).toHaveLength(1);
    expect(parsed.configuration.cutRule.fixedScore).toBe(80);
  });

  it('rejects unsupported legacy contest-management payloads', () => {
    expect(() =>
      ContestConfigurationRequestSchema.parse({
        selectionType: 'PICK_EM',
      }),
    ).toThrow();
  });
});
