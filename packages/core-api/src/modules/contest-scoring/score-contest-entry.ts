import type { FastifyBaseLogger } from 'fastify';
import { aggregateContestEntryScore } from './entry-aggregation-function-registry';
import { rebuildContestEntryParticipantScores } from './helpers';
import { scoreParticipantRule } from './participant-scoring-definition-registry';
import type { ScoreContestEntryContext, ScoreContestEntryResult } from './types';

export function scoreContestEntry(
  context: ScoreContestEntryContext,
  logger?: FastifyBaseLogger,
): ScoreContestEntryResult {
  logger?.debug({
    action: 'contestScoring.scoreEntry.start',
    data: {
      rosterPickCount: context.rosterPicks.length,
      scoringRuleCount: context.scoringRules.length,
      aggregationDefinitionId: context.aggregationRule.aggregationDefinitionId,
    },
  }, 'Scoring contest entry');
  const scoreEvents = context.scoringRules
    .filter((rule) => rule.active)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((rule) => scoreParticipantRule(context, rule));

  const participantScores = rebuildContestEntryParticipantScores(
    context.rosterPicks,
    scoreEvents,
  );

  const totalScore = aggregateContestEntryScore(
    participantScores,
    context.aggregationRule,
  );

  const result = {
    totalScore,
    participantScores,
    scoreEvents,
  };
  logger?.info({
    action: 'contestScoring.scoreEntry.success',
    data: {
      totalScore: result.totalScore,
      participantScoreCount: result.participantScores.length,
      scoreEventCount: result.scoreEvents.length,
    },
  }, 'Scored contest entry');
  return result;
}
