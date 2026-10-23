import type { ContestResultSummaryDto } from '@poolmaster/shared/dto';
import type { ContestResultView } from '../modules/history/service';
import { toChampionshipSquadDto } from './championship.mapper';

export function toContestResultSummaryDto(view: ContestResultView): ContestResultSummaryDto {
  return {
    contestId: view.contestId,
    name: view.name,
    sportLeagueName: view.sportLeagueName,
    selectionType: view.selectionType,
    completedAt: view.completedAt.toISOString(),
    rankedEntryCount: view.rankedEntryCount,
    count: view.count,
    winners: view.winners.map(toChampionshipSquadDto),
    squadFinish: view.squadFinish === null ? null : {
      place: view.squadFinish.place,
      displayPlace: view.squadFinish.tiedCount > 1 ? `T${view.squadFinish.place}` : String(view.squadFinish.place),
      points: view.squadFinish.points,
    },
  };
}
