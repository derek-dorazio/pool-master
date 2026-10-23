import type { CupDto, CupSquadPointsDto } from '@poolmaster/shared/dto';
import type { CupSquadPointsView, CupView } from '../modules/cups/service';

/** The cup's name, built from its season and sports league: "2026 PGA Tour Cup". */
function cupName(seasonYear: number, sportLeagueName: string): string {
  return `${seasonYear} ${sportLeagueName} Cup`;
}

export function toCupDto(view: CupView): CupDto {
  return {
    id: view.cup.id,
    leagueId: view.cup.leagueId,
    seasonYear: view.cup.seasonYear,
    sportLeagueId: view.cup.sportLeagueId,
    sportLeagueName: view.sportLeagueName,
    name: cupName(view.cup.seasonYear, view.sportLeagueName),
    standings: view.standings.map((row) => ({
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
    })),
    contests: view.contests.map((row) => ({
      contestId: row.contest.id,
      name: row.contest.name,
      status: row.contest.status,
      selectionType: row.contest.selectionType,
      cupWeight: row.contest.cupWeight,
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
    squadId: view.squad.id,
    squadName: view.squad.name,
    points: view.points,
    contests: view.contests.map((row) => ({
      contestId: row.contest.id,
      name: row.contest.name,
      cupWeight: row.contest.cupWeight,
      completedAt: row.contest.completedAt?.toISOString() ?? null,
      place: row.finish?.place ?? null,
      displayPlace: row.finish === null ? null : row.finish.tiedCount > 1 ? `T${row.finish.place}` : String(row.finish.place),
      rankedEntryCount: row.finish?.rankedEntryCount ?? 0,
      points: row.points,
    })),
  };
}
