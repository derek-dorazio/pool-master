/**
 * Head to head (#698, #699, plans/knockout-and-pickem-design.md §3.4): results are matches, who beat
 * whom, stored in the event's bracket rather than in a per-participant extension row; the field
 * read attaches each row's matches. A team's contest score is its knockout round points
 * (`KNOCKOUT_ROUND_POINTS`; score-team.ts holds every rule). Results are the admin's (the match
 * result service beside this file), or a provider's final for a match linked to its game (#1496),
 * written through that same service: it takes GAME live scores.
 */
import { ScoringFamily, UpsetBonusRule } from '@poolmaster/shared/domain';
import type { ScoringFamilyModule } from '../scoring-family-module';
import { createGameScoreWriterDeps } from '../../events/wiring';
import { writeGameScores } from './game-score-writer';
import { scoreKnockoutField } from './score-team';

export const headToHeadScoringFamily: ScoringFamilyModule = {
  scoreField(field, _event, scoring) {
    // Head to head scores only its own definition. A contest ranked by another family's definition
    // cannot be set up (contest management refuses a definition the sport does not offer); if one
    // were read, its record is read with no upset bonus and the team is left unscored rather than
    // scored under rules it lacks.
    const ownSettings = scoring.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS' ? scoring.config : null;
    const scores = scoreKnockoutField(field, ownSettings ?? { roundValues: [], upsetBonus: { rule: UpsetBonusRule.NONE } });
    return field.map((row, index) => {
      const { score, record } = scores[index];
      return {
        sportEventParticipantId: row.entry.id,
        name: row.participant.name,
        score: ownSettings ? score : null,
        detail: { scoringFamily: ScoringFamily.HEAD_TO_HEAD, ...record },
        asOf: row.standing?.standing.asOf ?? null,
      };
    });
  },

  // A team with no result wins no round, so each counting pick scores nothing.
  scoreMissedLineup(_field, _event, scoring) {
    return scoring.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS' ? 0 : null;
  },

  liveScores: {
    category: 'GAME',
    persist(deps, event, result) {
      return writeGameScores(
        createGameScoreWriterDeps(deps.prisma, deps.providerId, deps.logger, deps.leaderboards),
        event,
        result.games,
      );
    },
  },
};
