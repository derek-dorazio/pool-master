import type { ContestResultSummaryDto, HistorySummaryDto } from '@poolmaster/shared/dto';
import type { ContestResultView, HistorySummaryView } from '../modules/history/service';
import { toChampionshipSquadDto } from './championship.mapper';
import { cupName } from './cups.mapper';

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

export function toHistorySummaryDto(view: HistorySummaryView): HistorySummaryDto {
  return {
    tiles: view.tiles.map((tile) => ({ tile: tile.tile, count: tile.count, squads: tile.squads.map(toChampionshipSquadDto) })),
    years: view.years.map((year) => ({
      year: year.year,
      isOver: year.isOver,
      champions: year.champions.map(toChampionshipSquadDto),
      cups: year.cups.map((cup) => ({
        cupId: cup.view.cup.id,
        sportLeagueId: cup.view.cup.sportLeagueId,
        name: cupName(cup.view.cup.seasonYear, cup.view.sportLeagueName),
        status: cup.view.cup.status,
        contestsCounted: cup.contestsCounted,
        winners: cup.winners.map(toChampionshipSquadDto),
      })),
    })),
  };
}
