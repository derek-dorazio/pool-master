import type { ChampionshipDto, ChampionshipSquadDto, ChampionshipStandingRowDto, ChampionshipYearDto } from '@poolmaster/shared/dto';
import type { Squad } from '@poolmaster/shared/domain';
import type { ChampionshipStandingView, ChampionshipYearSummaryView, ChampionshipYearView } from '../modules/championship/service';

/** The championship's name: the year and the league's cup name, "2026 Derek's Pool Cup". */
export function championshipName(year: number, cupName: string): string {
  return `${year} ${cupName}`;
}

export function toChampionshipSquadDto(squad: Squad): ChampionshipSquadDto {
  return { squadId: squad.id, squadName: squad.name, squadIconKey: squad.iconKey };
}

export function toChampionshipStandingRowDto(row: ChampionshipStandingView): ChampionshipStandingRowDto {
  return {
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
    movement: row.movement,
  };
}

export function toChampionshipDto(view: ChampionshipYearView): ChampionshipDto {
  return {
    leagueId: view.leagueId,
    year: view.year,
    cupName: view.cupName,
    name: championshipName(view.year, view.cupName),
    isOver: view.isOver,
    contestsCounted: view.contestsCounted,
    contestsToGo: view.contestsToGo,
    standings: view.standings.map(toChampionshipStandingRowDto),
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
