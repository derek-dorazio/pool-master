import type { CupDto, CupProjectionDto, CupSquadPointsDto, CupStandingRowDto } from '@poolmaster/shared/dto';
import type { CupProjectionView, CupSquadPointsView, CupStandingView, CupView } from '../modules/cups/service';

/** The cup's name, built from its season and sports league: "2026 PGA Tour Cup". */
export function cupName(seasonYear: number, sportLeagueName: string): string {
  return `${seasonYear} ${sportLeagueName} Cup`;
}

export function toCupStandingRowDto(row: CupStandingView): CupStandingRowDto {
  return {
    squadId: row.squad.id,
    squadName: row.squad.name,
    squadIconKey: row.squad.iconKey,
    squadIsActive: row.squad.isActive,
    position: row.position,
    displayPosition: row.displayPosition,
    points: row.points,
    wins: row.wins,
    podiums: row.podiums,
    contestsCounted: row.contestsCounted,
    movement: row.movement,
    pointsAfter: row.pointsAfter,
    trophy: row.trophy,
  };
}

export function toCupDto(view: CupView): CupDto {
  return {
    id: view.cup.id,
    leagueId: view.cup.leagueId,
    seasonYear: view.cup.seasonYear,
    sportLeagueId: view.cup.sportLeagueId,
    sportLeagueName: view.sportLeagueName,
    name: cupName(view.cup.seasonYear, view.sportLeagueName),
    status: view.cup.status,
    crownedAt: view.cup.crownedAt?.toISOString() ?? null,
    standings: view.standings.map(toCupStandingRowDto),
    contests: view.contests.map((row) => ({
      contestId: row.contest.id,
      name: row.contest.name,
      status: row.contest.status,
      selectionType: row.contest.selectionType,
      cupWeight: row.weight,
      count: row.count,
      firstEventStartsAt: row.contest.firstEventStartsAt.toISOString(),
      completedAt: row.contest.completedAt?.toISOString() ?? null,
      winners: row.winners.map((squad) => ({ squadId: squad.id, squadName: squad.name })),
    })),
  };
}

export function toCupSquadPointsDto(view: CupSquadPointsView): CupSquadPointsDto {
  return {
    cupId: view.cup.id,
    cupName: cupName(view.cup.seasonYear, view.sportLeagueName),
    squadId: view.squad.id,
    squadName: view.squad.name,
    points: view.points,
    contests: view.contests.map((row) => ({
      contestId: row.contest.id,
      name: row.contest.name,
      cupWeight: row.weight,
      completedAt: row.contest.completedAt?.toISOString() ?? null,
      place: row.finish?.place ?? null,
      displayPlace: row.finish === null ? null : row.finish.tiedCount > 1 ? `T${row.finish.place}` : String(row.finish.place),
      rankedEntryCount: row.finish?.rankedEntryCount ?? 0,
      points: row.points,
    })),
  };
}

export function toCupProjectionDto(view: CupProjectionView): CupProjectionDto {
  return {
    cupId: view.cup.id,
    contests: view.contests.map((contest) => ({ contestId: contest.id, name: contest.name, cupWeight: contest.cupWeight })),
    standings: view.standings.map((row) => ({
      squadId: row.squad.id,
      position: row.position,
      displayPosition: row.displayPosition,
      points: row.points,
      gained: row.gained,
      movement: row.movement,
    })),
  };
}
