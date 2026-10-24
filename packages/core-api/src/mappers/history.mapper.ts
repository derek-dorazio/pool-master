import { TrophyKind } from '@poolmaster/shared/domain';
import type { ContestResultSummaryDto, HistorySummaryDto, PerpetualTrophyDto, RecordDto, RecordStandDto, SquadHistoryDto, SquadYearDto, YearReviewDto } from '@poolmaster/shared/dto';
import { formatUserName } from '../modules/email/email-content';
import type { ContestResultView, HistorySummaryView, PerpetualTrophyView, RecordStandView, RecordView, SquadHistoryView, SquadYearView } from '../modules/history/service';
import type { YearReviewView } from '../modules/history/year-review-service';
import { championshipName, toChampionshipSquadDto, toChampionshipStandingRowDto } from './championship.mapper';
import { cupName, toCupStandingRowDto } from './cups.mapper';

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

export function toSquadYearDto(view: SquadYearView): SquadYearDto {
  const { championship } = view;
  return {
    squadId: view.squad.id,
    year: view.year,
    championship: championship === null ? null : {
      name: championshipName(view.year, championship.cupName),
      isOver: championship.isOver,
      squadCount: championship.squadCount,
      pointsBehindLeader: championship.pointsBehindLeader,
      contestsCounted: championship.contestsCounted,
      contestsToGo: championship.contestsToGo,
      standing: toChampionshipStandingRowDto(championship.standing),
    },
    cups: view.cups.map((cup) => ({
      cupId: cup.view.cup.id,
      sportLeagueId: cup.view.cup.sportLeagueId,
      name: cupName(cup.view.cup.seasonYear, cup.view.sportLeagueName),
      status: cup.view.cup.status,
      contestsCounted: cup.contestsCounted,
      squadCount: cup.view.standings.length,
      standing: toCupStandingRowDto(cup.standing),
    })),
  };
}

export function toSquadHistoryDto(view: SquadHistoryView): SquadHistoryDto {
  return {
    squadId: view.squad.id,
    medals: view.medals,
    trophies: view.trophies.map((trophy) => (trophy.kind === TrophyKind.CHAMPIONSHIP
      ? { kind: trophy.kind, year: trophy.year, trophy: trophy.trophy, name: championshipName(trophy.year, trophy.cupName), cupId: null, sportLeagueId: null }
      : {
          kind: trophy.kind,
          year: trophy.year,
          trophy: trophy.trophy,
          name: cupName(trophy.cup.cup.seasonYear, trophy.cup.sportLeagueName),
          cupId: trophy.cup.cup.id,
          sportLeagueId: trophy.cup.cup.sportLeagueId,
        })),
    years: view.years.map(toSquadYearDto),
  };
}

export function toYearReviewDto(view: YearReviewView): YearReviewDto {
  return {
    year: view.year,
    status: view.status,
    sentAt: view.sentAt?.toISOString() ?? null,
    sentByName: view.sentBy === null ? null : formatUserName(view.sentBy),
  };
}

export function toRecordDto(view: RecordView): RecordDto {
  return { type: view.type, best: toRecordStandDto(view.best), nextBest: view.nextBest === null ? null : toRecordStandDto(view.nextBest) };
}

function toRecordStandDto(view: RecordStandView): RecordStandDto {
  return {
    value: view.value,
    holders: view.holders.map((holder) => ({
      squad: toChampionshipSquadDto(holder.squad),
      year: holder.year,
      contestId: holder.contest?.id ?? null,
      contestName: holder.contest?.name ?? null,
    })),
  };
}

export function toPerpetualTrophyDto(view: PerpetualTrophyView): PerpetualTrophyDto {
  return {
    eventSeriesId: view.eventSeriesId,
    seriesName: view.seriesName,
    sportLeagueName: view.sportLeagueName,
    selectionType: view.selectionType,
    plates: view.plates.map((plate) => ({
      year: plate.year,
      contestId: plate.contestId,
      winners: plate.winners.map(toChampionshipSquadDto),
    })),
  };
}
