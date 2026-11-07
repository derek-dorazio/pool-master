/**
 * A survivor contest's leaderboard → DTO (#719). `ContestService.getSurvivorLeaderboard` answers
 * with a `SurvivorLeaderboardModel`; the published `SurvivorLeaderboardResponse` is shaped here.
 */

import type { SportEventStatus, SurvivorWeekOutcome } from '@poolmaster/shared/domain';
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

export interface SurvivorLeaderboardEntryWeekRow {
  sportEventId: string;
  roundNumber: number;
  outcome: SurvivorWeekOutcome | null;
  team: string | null;
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
      weeks: entry.weeks.map((week) => ({ ...week })),
    })),
  };
}
