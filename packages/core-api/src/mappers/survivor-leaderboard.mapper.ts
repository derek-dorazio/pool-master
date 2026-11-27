/**
 * A survivor contest's leaderboard → DTO (#719). `ContestService.getSurvivorLeaderboard` answers
 * with a `SurvivorLeaderboardModel`; the published `SurvivorLeaderboardResponse` is shaped here.
 */

import type { HomeAway, MatchStatus, SportEventStatus, SurvivorWeekOutcome } from '@poolmaster/shared/domain';
import type { SurvivorLeaderboardResponse } from '@poolmaster/shared/dto';

export interface SurvivorLeaderboardWeekRow {
  sportEventId: string;
  weekNumber: number;
  /** The round of the event the week is; 1 for a regular-season week. */
  roundNumber: number;
  roundCount: number;
  name: string;
  startDate: Date;
  status: SportEventStatus;
  started: boolean;
  aliveCount: number;
}

/** A shown pick's game (#1757), from the picked team's side. */
export interface SurvivorLeaderboardPickGameRow {
  opponent: string;
  opponentShortName: string | null;
  /** The picked team's side in the game. */
  sideNumber: number;
  /** Where the picked team played: its side's place in the game's first Game. */
  homeAway: HomeAway;
  scheduledDate: Date | null;
  status: MatchStatus;
  teamScore: number | null;
  opponentScore: number | null;
}

export interface SurvivorLeaderboardEntryWeekRow {
  sportEventId: string;
  roundNumber: number;
  outcome: SurvivorWeekOutcome | null;
  team: string | null;
  teamShortName: string | null;
  /** Shown with the team, so null whenever it is. */
  game: SurvivorLeaderboardPickGameRow | null;
}

export interface SurvivorLeaderboardEntryRow {
  entryId: string;
  entryName: string;
  entryNumber: number;
  squadId: string;
  squadName: string;
  alive: boolean;
  eliminatedInWeek: number | null;
  weeksSurvived: number;
  /** The lives the entry has left (#1754): 0 once it is out. */
  livesLeft: number;
  /** The weeks that cost the entry a life, the one that put it out included. */
  livesLost: number;
  position: number;
  displayPosition: string;
  weeks: SurvivorLeaderboardEntryWeekRow[];
}

export interface SurvivorLeaderboardModel {
  contestId: string;
  weeks: SurvivorLeaderboardWeekRow[];
  entries: SurvivorLeaderboardEntryRow[];
}

/** A stored leaderboard (#1435) as the API answers it: the board it holds, mapped by `toSurvivorLeaderboardResponse` when computed. */
export function toSurvivorLeaderboardSnapshotResponse(snapshot: { board: SurvivorLeaderboardResponse }): SurvivorLeaderboardResponse {
  return snapshot.board;
}

export function toSurvivorLeaderboardResponse(model: SurvivorLeaderboardModel): SurvivorLeaderboardResponse {
  return {
    contestId: model.contestId,
    weeks: model.weeks.map((week) => ({ ...week, startDate: week.startDate.toISOString() })),
    entries: model.entries.map((entry) => ({
      ...entry,
      weeks: entry.weeks.map((week) => ({
        ...week,
        game: week.game === null ? null : { ...week.game, scheduledDate: week.game.scheduledDate?.toISOString() ?? null },
      })),
    })),
  };
}
