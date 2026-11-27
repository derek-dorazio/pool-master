/**
 * Finish position (racing, #622): a runner's contest score is the points its finishing place
 * earns from the contest's points table (`FINISH_POSITION_POINTS`); a non-finisher scores the
 * table's "did not finish" value (score-runner.ts holds every rule). Results are the admin's
 * finishing order, stored as each runner's side result in the race's one FIELD Game (#2008). It takes no live
 * scores: no racing feed exists yet (plans/racing-sports.md Q9.4).
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import type { ScoringFamilyModule } from '../scoring-family-module';
import { isRaceResultOfficial, raceResultOf, scoreRunner } from './score-runner';

export const finishPositionScoringFamily: ScoringFamilyModule = {
  scoreField(field, _event, scoring) {
    // Finish position scores only its own definition. A contest ranked by another family's
    // definition cannot be set up (contest management refuses a definition the sport does not
    // offer), and if one were read it is left unscored rather than scored under rules it lacks.
    const settings = scoring.participantScoringDefinitionId === 'FINISH_POSITION_POINTS' ? scoring.config : null;
    const raceOfficial = isRaceResultOfficial(field);
    return field.map((row) => ({
      sportEventParticipantId: row.entry.id,
      name: row.participant.name,
      score: settings ? scoreRunner(row, settings, raceOfficial) : null,
      detail: { scoringFamily: ScoringFamily.FINISH_POSITION },
      asOf: row.standing?.standing.asOf ?? raceResultOf(row)?.updatedAt ?? null,
    }));
  },

  liveScores: null,
};
