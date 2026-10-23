import type { ChampionshipDto, ChampionshipSquadDto, ChampionshipYearDto } from '@poolmaster/shared/dto';
import type { Squad } from '@poolmaster/shared/domain';
import type { ChampionshipYearSummaryView, ChampionshipYearView } from '../modules/championship/service';

export function toChampionshipSquadDto(squad: Squad): ChampionshipSquadDto {
  return { squadId: squad.id, squadName: squad.name, squadIconKey: squad.iconKey };
}

export function toChampionshipDto(view: ChampionshipYearView): ChampionshipDto {
  return {
    leagueId: view.leagueId,
    year: view.year,
    cupName: view.cupName,
    name: `${view.year} ${view.cupName}`,
    isOver: view.isOver,
    contestsCounted: view.contestsCounted,
    contestsToGo: view.contestsToGo,
    standings: view.standings.map((row) => ({
      squadId: row.squad.id,
      squadName: row.squad.name,
      squadIconKey: row.squad.iconKey,
      squadIsActive: row.squad.isActive,
      position: row.position,
      displayPosition: row.displayPosition,
      points: row.points,
      finishes: row.finishes,
      podiums: row.podiums,
      topTens: row.topTens,
      played: row.played,
    })),
    tiles: view.tiles.map((tile) => ({
      tile: tile.tile,
      count: tile.count,
      squads: tile.squads.map(toChampionshipSquadDto),
    })),
  };
}

export function toChampionshipYearDto(view: ChampionshipYearSummaryView): ChampionshipYearDto {
  return { year: view.year, isOver: view.isOver, leaders: view.leaders.map(toChampionshipSquadDto) };
}
