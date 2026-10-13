/**
 * Stroke play (golf): a golfer's contest score is their event total against par, read off the
 * standing's golf extension, with every round they did not play scored as 80 strokes (#478).
 * Results are stored in the golf round and standing extension rows. Its one scoring definition
 * (to-par total) takes no contest settings, so `scoreField` reads none. It accepts GOLF live
 * scores.
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import { createGolfScoreService } from '../../events/wiring';
import type { ScoringFamilyModule } from '../scoring-family-module';
import { buildUnplayedRoundContext, scoreGolferForContest } from './unplayed-rounds';

export const strokePlayScoringFamily: ScoringFamilyModule = {
  scoreField(field, event) {
    const context = buildUnplayedRoundContext(field, event);
    return field.map((row) => {
      const { score, unplayedRoundNumbers } = scoreGolferForContest(row, context);
      return {
        sportEventParticipantId: row.entry.id,
        name: row.participant.name,
        score,
        detail: { scoringFamily: ScoringFamily.STROKE_PLAY, unplayedRoundNumbers },
        asOf: row.standing?.standing.asOf ?? null,
      };
    });
  },

  liveScores: {
    category: 'GOLF',
    persist(deps, event, result) {
      return createGolfScoreService(deps.prisma, deps.logger).persistRoundUpdatesForSportEvent(
        event.id,
        result.rounds,
        deps.providerId,
        event.rounds,
      );
    },
  },

  entryStandingDetail(total) {
    return { golf: { totalScoreToPar: total } };
  },

  settledEntryTotal(standing) {
    return standing.golf?.totalScoreToPar ?? null;
  },
};
