import { scoreContestEntry } from '../../../packages/core-api/src/modules/contest-scoring';
import type {
  ContestEntryAggregationRule,
  ParticipantContestScoringRule,
  ScoreContestEntryContext,
} from '../../../packages/core-api/src/modules/contest-scoring';

function createScoringRule(
  id: string,
  participantScoringDefinitionId: ParticipantContestScoringRule['participantScoringDefinitionId'],
  sortOrder: number,
  config: Record<string, unknown>,
): ParticipantContestScoringRule {
  return {
    id,
    participantScoringDefinitionId,
    sortOrder,
    config,
    active: true,
  };
}

function createAggregationRule(
  aggregationDefinitionId: ContestEntryAggregationRule['aggregationDefinitionId'],
  config: Record<string, unknown>,
): ContestEntryAggregationRule {
  return {
    id: `agg-${aggregationDefinitionId}`,
    aggregationDefinitionId,
    config,
    active: true,
  };
}

function createBaseContext(
  overrides: Partial<ScoreContestEntryContext> = {},
): ScoreContestEntryContext {
  return {
    rosterPicks: [],
    sourceData: [],
    scoringRules: [],
    aggregationRule: createAggregationRule('SUM_ALL_ENTRIES', {}),
    ...overrides,
  };
}

describe('contest-scoring registries', () => {
  it('scores golf relative-to-par totals with an optional missed-cut penalty', () => {
    const context = createBaseContext({
      rosterPicks: [
        { id: 'pick-1', sportEventParticipantId: 'event-participant-1' },
        { id: 'pick-2', sportEventParticipantId: 'event-participant-2' },
      ],
      sourceData: [
        {
          sportEventParticipantId: 'event-participant-1',
          rawPayload: {},
          normalizedData: { scoreToPar: -8, madeCut: true },
        },
        {
          sportEventParticipantId: 'event-participant-2',
          rawPayload: {},
          normalizedData: { scoreToPar: 2, madeCut: false },
        },
      ],
      scoringRules: [
        createScoringRule('rule-golf', 'GOLF_RELATIVE_TO_PAR_TOTAL', 1, {
          missedCutPenalty: 10,
        }),
      ],
    });

    const result = scoreContestEntry(context);

    expect(result.participantScores).toEqual([
      { rosterPickId: 'pick-1', pointsEarned: -8 },
      { rosterPickId: 'pick-2', pointsEarned: 12 },
    ]);
    expect(result.totalScore).toBe(4);
    expect(result.scoreEvents[1]).toMatchObject({
      rosterPickId: 'pick-2',
      points: 12,
      detailsJson: { scoreToPar: 2, penaltyApplied: 10, madeCut: false },
    });
  });

  it('scores team wins, round multipliers, and seed bonuses as independent participant score events', () => {
    const context = createBaseContext({
      rosterPicks: [{ id: 'pick-1', sportEventParticipantId: 'event-participant-1' }],
      sourceData: [
        {
          sportEventParticipantId: 'event-participant-1',
          rawPayload: {},
          normalizedData: {
            completedWins: [
              { round: 1, seed: 10, opponentSeed: 7 },
              { round: 2, seed: 10, opponentSeed: 2 },
            ],
          },
        },
      ],
      scoringRules: [
        createScoringRule('rule-wins', 'TEAM_WIN_POINTS', 1, {
          pointsPerWin: 1,
        }),
        createScoringRule('rule-round', 'ROUND_MULTIPLIER', 2, {
          roundMultipliers: { '1': 1, '2': 2 },
        }),
        createScoringRule('rule-seed', 'SEED_DIFFERENTIAL_BONUS', 3, {
          underdogOnly: true,
        }),
      ],
    });

    const result = scoreContestEntry(context);

    expect(result.scoreEvents).toHaveLength(6);
    expect(result.participantScores).toEqual([
      {
        rosterPickId: 'pick-1',
        pointsEarned: 1 + 1 + 3 + 1 + 2 + 8,
      },
    ]);
    expect(result.totalScore).toBe(16);
  });

  it('sums only the top N participant totals when configured', () => {
    const context = createBaseContext({
      rosterPicks: [
        { id: 'pick-1', sportEventParticipantId: 'event-participant-1' },
        { id: 'pick-2', sportEventParticipantId: 'event-participant-2' },
        { id: 'pick-3', sportEventParticipantId: 'event-participant-3' },
      ],
      sourceData: [
        {
          sportEventParticipantId: 'event-participant-1',
          rawPayload: {},
          normalizedData: { scoreToPar: -4, madeCut: true },
        },
        {
          sportEventParticipantId: 'event-participant-2',
          rawPayload: {},
          normalizedData: { scoreToPar: -1, madeCut: true },
        },
        {
          sportEventParticipantId: 'event-participant-3',
          rawPayload: {},
          normalizedData: { scoreToPar: 3, madeCut: true },
        },
      ],
      scoringRules: [
        createScoringRule('rule-golf', 'GOLF_RELATIVE_TO_PAR_TOTAL', 1, {}),
      ],
      aggregationRule: createAggregationRule('SUM_TOP_N_ENTRIES', {
        topN: 2,
        lowerIsBetter: true,
      }),
    });

    const result = scoreContestEntry(context);

    expect(result.participantScores).toEqual([
      { rosterPickId: 'pick-1', pointsEarned: -4 },
      { rosterPickId: 'pick-2', pointsEarned: -1 },
      { rosterPickId: 'pick-3', pointsEarned: 3 },
    ]);
    expect(result.totalScore).toBe(-5);
  });
});
