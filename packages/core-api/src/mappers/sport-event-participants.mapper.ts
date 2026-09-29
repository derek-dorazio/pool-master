/**
 * Event-participant mapper (#236) — one field row's view (the row, its participant,
 * valuation, standing and rounds) → the canonical SportEventParticipantDto. At the
 * standing and each round the sport's extension is nested under its sport's key, the
 * shape the schema has.
 */

import type { SportEventParticipantDto } from '@poolmaster/shared/dto/events.dto';
import type { SportEventParticipantView } from '../modules/events/sport-event-participant-service';
import { mapParticipantToDto } from './participants.mapper';

export function mapSportEventParticipantToDto(view: SportEventParticipantView): SportEventParticipantDto {
  const { entry, valuation, standing } = view;
  return {
    id: entry.id,
    sportEventId: entry.sportEventId,
    participantId: entry.participantId,
    isActive: entry.isActive,
    inactiveReason: entry.inactiveReason ?? null,
    ranking: entry.ranking ?? null,
    oddsToWin: entry.oddsToWin ?? null,
    seedNumber: entry.seedNumber ?? null,
    participant: mapParticipantToDto(view.participant),
    valuation: valuation
      ? {
          id: valuation.id,
          sportEventTierId: valuation.sportEventTierId,
          tierOrderIndex: valuation.tierOrderIndex,
          tierAssignedSource: valuation.tierAssignedSource,
          price: valuation.price,
          priceAssignedSource: valuation.priceAssignedSource,
        }
      : null,
    standing: standing
      ? {
          id: standing.standing.id,
          position: standing.standing.position,
          displayPosition: standing.standing.displayPosition,
          status: standing.standing.status,
          asOf: standing.standing.asOf?.toISOString() ?? null,
          currentRound: standing.standing.currentRound,
          golf: standing.golf
            ? {
                eventScoreToPar: standing.golf.eventScoreToPar,
                eventStrokes: standing.golf.eventStrokes,
                currentRoundThru: standing.golf.currentRoundThru,
              }
            : null,
        }
      : null,
    rounds: view.rounds.map(({ round, golf }) => ({
      id: round.id,
      sportEventRoundId: round.sportEventRoundId,
      roundNumber: round.roundNumber,
      status: round.status,
      completedAt: round.completedAt?.toISOString() ?? null,
      golf: golf ? { strokes: golf.strokes, scoreToPar: golf.scoreToPar, thru: golf.thru } : null,
    })),
    affiliatedWithSportLeague: view.affiliatedWithSportLeague,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
