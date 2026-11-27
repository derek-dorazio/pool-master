/**
 * Event-participant mapper (#236) — one field row's view (the row, its participant,
 * valuation, standing and its FIELD Game results) → the canonical SportEventParticipantDto.
 * A golf round is the row's scored side result in that round's FIELD Game (#2008), shown under
 * `rounds` with its golf block; a race result under `race`.
 */

import { latestParticipantRound } from '@poolmaster/shared/domain';
import type { SportEventParticipantDto } from '@poolmaster/shared/dto/events.dto';
import type { SportEventParticipantView } from '../modules/events/sport-event-participant-service';
import { isRaceOfficial, raceResultOf } from '../modules/scoring-families/finish-position/score-runner';
import { roundStatusOfSide, scoredRoundsOf } from '../modules/scoring-families/stroke-play/scored-rounds';
import { mapParticipantToDto } from './participants.mapper';

export function mapSportEventParticipantToDto(view: SportEventParticipantView): SportEventParticipantDto {
  const { entry, valuation, standing } = view;
  const rounds = scoredRoundsOf(view);
  // The highest round it has a score in (#2047): read off its rounds, never stored.
  const current = latestParticipantRound(rounds, (round) => round);
  return {
    id: entry.id,
    sportEventId: entry.sportEventId,
    participantId: entry.participantId,
    status: entry.status,
    ranking: entry.ranking ?? null,
    oddsToWin: entry.oddsToWin ?? null,
    seedNumber: entry.seedNumber ?? null,
    participant: mapParticipantToDto(view.participant),
    valuation: valuation
      ? {
          id: valuation.id,
          sportEventTierId: valuation.sportEventSlotTierId,
          tierOrderIndex: valuation.tierOrderIndex,
          tierAssignedSource: valuation.tierAssignedSource,
          price: valuation.price,
          priceAssignedSource: valuation.priceAssignedSource,
        }
      : null,
    standing: standing
      ? {
          id: standing.id,
          position: standing.position,
          displayPosition: standing.displayPosition,
          status: standing.status,
          asOf: standing.asOf?.toISOString() ?? null,
          currentRound: current?.roundNumber ?? null,
          golf: standing.total !== null && standing.scoreToPar !== null
            ? {
                eventScoreToPar: standing.scoreToPar,
                eventStrokes: standing.total,
                currentRoundThru: current?.result.periodsCompleted ?? null,
              }
            : null,
        }
      : null,
    rounds: rounds.map((round) => ({
      id: round.result.sportEventRoundMatchSideId,
      sportEventRoundId: round.sportEventRoundId,
      roundNumber: round.roundNumber,
      status: roundStatusOfSide(round.result.status),
      completedAt: round.result.status === null ? null : round.gameCompletedAt?.toISOString() ?? null,
      golf: { strokes: round.result.score, scoreToPar: round.result.scoreToPar, thru: round.result.periodsCompleted },
    })),
    // One FIELD result list holds either a golfer's rounds or a runner's race: a row scored in rounds has no race.
    race: rounds.length > 0 ? null : raceBlockOf(view),
    affiliatedWithSportLeague: view.affiliatedWithSportLeague,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

/** The runner's race result (#2008): its side result in the race's one FIELD Game, and its rider. */
function raceBlockOf(view: SportEventParticipantView): SportEventParticipantDto['race'] {
  const raced = raceResultOf(view);
  if (!raced || raced.result.status === null) return null;
  return {
    finishPosition: raced.result.position,
    startPosition: raced.result.startPosition,
    resultStatus: raced.result.status,
    isOfficial: isRaceOfficial(raced),
  };
}
