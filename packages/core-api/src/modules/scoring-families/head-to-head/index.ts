/**
 * Head to head (#698, plans/knockout-and-pickem-design.md §3.4): results are matches, who beat
 * whom, stored in the event's bracket rather than in a per-participant extension row. It has no
 * scoring definition yet: knockout round points and the upset bonus arrive with results entry
 * (#699), so no contest can be set up on its events and every field row is left unscored. It takes
 * no live scores: the admin enters results.
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import type { ScoringFamilyModule } from '../scoring-family-module';

export const headToHeadScoringFamily: ScoringFamilyModule = {
  scoreField(field) {
    return field.map((row) => ({
      sportEventParticipantId: row.entry.id,
      name: row.participant.name,
      score: null,
      detail: { scoringFamily: ScoringFamily.HEAD_TO_HEAD },
      asOf: null,
    }));
  },

  liveScores: null,
};
