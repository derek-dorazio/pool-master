/** Slot tiebreaker mapper (#2048): a slot's tiebreaker game and its Games to their DTOs. */
import type { SportEventSlotTiebreakerDto } from '@poolmaster/shared/dto';
import type { SlotTiebreakerView } from '../modules/events/slot-tiebreaker-service';

export function toSportEventSlotTiebreakerDto(slot: SlotTiebreakerView): SportEventSlotTiebreakerDto {
  return {
    seasonSlotId: slot.seasonSlotId,
    tiebreakerGameId: slot.tiebreakerGameId,
    chosenAt: slot.chosen?.at.toISOString() ?? null,
    chosenByUserId: slot.chosen?.byUserId ?? null,
    editable: slot.editable,
    games: slot.games.map((game) => ({
      id: game.id,
      sportEventRoundMatchId: game.sportEventRoundMatchId,
      gameNumber: game.gameNumber,
      scheduledDate: game.scheduledDate?.toISOString() ?? null,
      status: game.status,
      moved: game.moved,
      choosable: game.choosable,
    })),
  };
}
