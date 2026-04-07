import type {
  ComputedContestEntryParticipantScoreEvent,
  GolfParticipantNormalizedData,
  ParticipantContestScoringRule,
  ParticipantScoringDefinitionRegistryItem,
  ScoreContestEntryContext,
  TeamParticipantNormalizedData,
} from './types';
import { findParticipantSourceData, getNormalizedData } from './helpers';

interface GolfRelativeToParRuleConfig {
  missedCutPenalty?: number;
}

interface TeamWinPointsRuleConfig {
  pointsPerWin: number;
}

interface RoundMultiplierRuleConfig {
  roundMultipliers: Record<string, number>;
}

interface SeedDifferentialBonusRuleConfig {
  underdogOnly?: boolean;
  bonusMultiplier?: number;
}

function scoreGolfRelativeToParTotal(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ComputedContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as unknown as GolfRelativeToParRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantSourceData(context, pick.id);
    const data = getNormalizedData<GolfParticipantNormalizedData>(source);
    if (!data) {
      return [];
    }

    const penalty = data.madeCut === false ? (config.missedCutPenalty ?? 0) : 0;
    const scoreToPar = data.scoreToPar ?? 0;

    return [
      {
        rosterPickId: pick.id,
        participantContestScoringRuleId: scoringRule.id,
        points: scoreToPar + penalty,
        detailsJson: {
          scoreToPar,
          madeCut: data.madeCut ?? null,
          penaltyApplied: penalty,
        },
      },
    ];
  });
}

function scoreTeamWinPoints(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ComputedContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as unknown as TeamWinPointsRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantSourceData(context, pick.id);
    const data = getNormalizedData<TeamParticipantNormalizedData>(source);
    if (!data?.completedWins?.length) {
      return [];
    }

    return data.completedWins.map((win, index) => ({
      rosterPickId: pick.id,
      participantContestScoringRuleId: scoringRule.id,
      points: config.pointsPerWin,
      detailsJson: {
        eventType: 'TEAM_WIN_POINTS',
        winIndex: index,
        round: win.round,
        pointsPerWin: config.pointsPerWin,
      },
    }));
  });
}

function scoreRoundMultiplier(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ComputedContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as unknown as RoundMultiplierRuleConfig;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantSourceData(context, pick.id);
    const data = getNormalizedData<TeamParticipantNormalizedData>(source);
    if (!data?.completedWins?.length) {
      return [];
    }

    return data.completedWins.flatMap((win, index) => {
      const points = config.roundMultipliers[String(win.round)];
      if (points == null) {
        return [];
      }

      return [
        {
          rosterPickId: pick.id,
          participantContestScoringRuleId: scoringRule.id,
          points,
          detailsJson: {
            eventType: 'ROUND_MULTIPLIER',
            winIndex: index,
            round: win.round,
            multiplierPoints: points,
          },
        },
      ];
    });
  });
}

function scoreSeedDifferentialBonus(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ComputedContestEntryParticipantScoreEvent[] {
  const config = scoringRule.config as unknown as SeedDifferentialBonusRuleConfig;
  const bonusMultiplier = config.bonusMultiplier ?? 1;

  return context.rosterPicks.flatMap((pick) => {
    const source = findParticipantSourceData(context, pick.id);
    const data = getNormalizedData<TeamParticipantNormalizedData>(source);
    if (!data?.completedWins?.length) {
      return [];
    }

    return data.completedWins.flatMap((win, index) => {
      if (win.seed == null || win.opponentSeed == null) {
        return [];
      }

      const differential = win.seed - win.opponentSeed;
      if (config.underdogOnly && differential <= 0) {
        return [];
      }

      const bonus = Math.max(differential, 0) * bonusMultiplier;
      if (bonus === 0) {
        return [];
      }

      return [
        {
          rosterPickId: pick.id,
          participantContestScoringRuleId: scoringRule.id,
          points: bonus,
          detailsJson: {
            eventType: 'SEED_DIFFERENTIAL_BONUS',
            winIndex: index,
            round: win.round,
            seed: win.seed,
            opponentSeed: win.opponentSeed,
            differential,
            bonusMultiplier,
          },
        },
      ];
    });
  });
}

export const ParticipantScoringDefinitionRegistry: Record<
  string,
  ParticipantScoringDefinitionRegistryItem
> = {
  GOLF_RELATIVE_TO_PAR_TOTAL: {
    id: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    name: 'Golf Relative To Par Total',
    description:
      'Scores a golfer by current score relative to par, with optional missed-cut penalty.',
    supportedContestTypes: ['SINGLE_EVENT'],
    scoreParticipant: scoreGolfRelativeToParTotal,
  },
  TEAM_WIN_POINTS: {
    id: 'TEAM_WIN_POINTS',
    name: 'Team Win Points',
    description: 'Awards a fixed number of points for each completed team win.',
    supportedContestTypes: ['SINGLE_EVENT'],
    scoreParticipant: scoreTeamWinPoints,
  },
  ROUND_MULTIPLIER: {
    id: 'ROUND_MULTIPLIER',
    name: 'Round Multiplier',
    description: 'Awards round-specific win points for each completed team win.',
    supportedContestTypes: ['SINGLE_EVENT'],
    scoreParticipant: scoreRoundMultiplier,
  },
  SEED_DIFFERENTIAL_BONUS: {
    id: 'SEED_DIFFERENTIAL_BONUS',
    name: 'Seed Differential Bonus',
    description:
      'Awards bonus points when a lower-seeded team beats a higher-seeded team.',
    supportedContestTypes: ['SINGLE_EVENT'],
    scoreParticipant: scoreSeedDifferentialBonus,
  },
};

export function scoreParticipantRule(
  context: ScoreContestEntryContext,
  scoringRule: ParticipantContestScoringRule,
): ComputedContestEntryParticipantScoreEvent[] {
  const definition =
    ParticipantScoringDefinitionRegistry[scoringRule.participantScoringDefinitionId];

  if (!definition) {
    throw new Error(
      `Unsupported participant scoring definition: ${scoringRule.participantScoringDefinitionId}`,
    );
  }

  return definition.scoreParticipant(context, scoringRule);
}
