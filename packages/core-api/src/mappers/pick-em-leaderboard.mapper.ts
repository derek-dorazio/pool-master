/**
 * A pick'em contest's leaderboard → DTO (#717). `ContestService.getPickEmLeaderboard` answers
 * with a `PickEmLeaderboardModel`; the published `PickEmLeaderboardResponse` is shaped here.
 */

import type { PickEmMode, SportEventStatus } from '@poolmaster/shared/domain';
import type { PickEmLeaderboardResponse } from '@poolmaster/shared/dto';

export interface PickEmLeaderboardWeekRow {
  sportEventId: string;
  name: string;
  startDate: Date;
  status: SportEventStatus;
  started: boolean;
  settled: boolean;
  gameCount: number;
  tiebreakerTotalPoints: number | null;
  winnerEntryIds: string[];
}

export interface PickEmLeaderboardEntryWeekRow {
  sportEventId: string;
  submitted: boolean;
  points: number | null;
  position: number | null;
  displayPosition: string | null;
  weeklyWinner: boolean;
}

export interface PickEmLeaderboardEntryRow {
  entryId: string;
  entryName: string;
  entryNumber: number;
  squadId: string;
  squadName: string;
  position: number | null;
  displayPosition: string | null;
  totalPoints: number;
  weeks: PickEmLeaderboardEntryWeekRow[];
}

export interface PickEmLeaderboardModel {
  contestId: string;
  mode: PickEmMode;
  againstTheSpread: boolean;
  weeks: PickEmLeaderboardWeekRow[];
  entries: PickEmLeaderboardEntryRow[];
}

export function toPickEmLeaderboardResponse(model: PickEmLeaderboardModel): PickEmLeaderboardResponse {
  return {
    contestId: model.contestId,
    mode: model.mode,
    againstTheSpread: model.againstTheSpread,
    weeks: model.weeks.map((week) => ({
      ...week,
      startDate: week.startDate.toISOString(),
      winnerEntryIds: [...week.winnerEntryIds],
    })),
    entries: model.entries.map((entry) => ({
      ...entry,
      weeks: entry.weeks.map((week) => ({ ...week })),
    })),
  };
}
