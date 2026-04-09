import { aggregateContestEntryScore } from './entry-aggregation-function-registry';
import { rebuildContestEntryParticipantScores } from './helpers';
import { scoreParticipantRule } from './participant-scoring-definition-registry';
import type { ScoreContestEntryContext, ScoreContestEntryResult } from './types';

export function scoreContestEntry(
  context: ScoreContestEntryContext,
): ScoreContestEntryResult {
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

  return {
    totalScore,
    participantScores,
    scoreEvents,
  };
}
