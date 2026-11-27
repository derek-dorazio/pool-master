/**
 * Stroke play (golf): a golfer's contest score is their event total against par, read off the
 * standing, with every round they did not play scored as the contest's `unplayedRoundToPar`
 * (#478). Results are each golfer's side result in the round's FIELD Game. It accepts GOLF live
 * scores.
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import { createStrokePlayResultService } from '../../events/wiring';
import type { ScoringFamilyModule } from '../scoring-family-module';
import { buildUnplayedRoundContext, scoreGolferForContest, unplayedRoundToParOf } from './unplayed-rounds';

export const strokePlayScoringFamily: ScoringFamilyModule = {
  scoreField(field, event, scoring) {
    const unplayedRoundToPar = unplayedRoundToParOf(scoring);
    const context = unplayedRoundToPar === null ? null : buildUnplayedRoundContext(field, event, unplayedRoundToPar);
    return field.map((row) => {
      const { score, unplayedRoundNumbers } = context
        ? scoreGolferForContest(row, context)
        : { score: null, unplayedRoundNumbers: [] };
      return {
        sportEventParticipantId: row.entry.id,
        name: row.participant.name,
        score,
        detail: { scoringFamily: ScoringFamily.STROKE_PLAY, unplayedRoundNumbers },
        asOf: row.standing?.asOf ?? null,
      };
    });
  },

  liveScores: {
    category: 'GOLF',
    persist(deps, event, result) {
      return createStrokePlayResultService(deps.prisma, deps.domainEvents, deps.logger).persistRoundUpdatesForSportEvent(
        event.id,
        result.rounds,
        deps.providerId,
        { final: result.final ?? false },
      );
    },
  },
};
