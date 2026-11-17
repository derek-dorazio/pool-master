/**
 * A pick'em contest's leaderboard → DTO (#717). `ContestService.getPickEmLeaderboard` answers
 * with a `PickEmLeaderboardModel`; the published `PickEmLeaderboardResponse` is shaped here.
 */

import type { PickEmMode, PickOutcome, SportEventStatus } from '@poolmaster/shared/domain';
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
  placedEntryCount: number;
  winnerEntryIds: string[];
}

export interface PickEmLeaderboardEntryWeekRow {
  sportEventId: string;
  submitted: boolean;
  points: number | null;
  position: number | null;
  displayPosition: string | null;
  weeklyWinner: boolean;
  correctPickCount: number | null;
  missedPicks: PickEmLeaderboardMissedPickRow[];
}

export interface PickEmLeaderboardMissedPickRow {
  /** Null for a tie pick. */
  teamName: string | null;
}

export interface PickEmLeaderboardEntryPickRow {
  sportEventMatchId: string;
  sportEventParticipantId: string | null;
  outcome: PickOutcome;
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
  currentWeekPicks: PickEmLeaderboardEntryPickRow[];
}

export interface PickEmLeaderboardModel {
  contestId: string;
  currentWeekId: string | null;
  mode: PickEmMode;
  againstTheSpread: boolean;
  weeks: PickEmLeaderboardWeekRow[];
  entries: PickEmLeaderboardEntryRow[];
}

/** A stored leaderboard (#1435) as the API answers it: the board it holds, mapped by `toPickEmLeaderboardResponse` when computed. */
export function toPickEmLeaderboardSnapshotResponse(snapshot: { board: PickEmLeaderboardResponse }): PickEmLeaderboardResponse {
  return snapshot.board;
}

export function toPickEmLeaderboardResponse(model: PickEmLeaderboardModel): PickEmLeaderboardResponse {
  return {
    contestId: model.contestId,
    currentWeekId: model.currentWeekId,
    mode: model.mode,
    againstTheSpread: model.againstTheSpread,
    weeks: model.weeks.map((week) => ({
      ...week,
      startDate: week.startDate.toISOString(),
      winnerEntryIds: [...week.winnerEntryIds],
    })),
    entries: model.entries.map((entry) => ({
      ...entry,
      weeks: entry.weeks.map((week) => ({ ...week, missedPicks: week.missedPicks.map((miss) => ({ ...miss })) })),
      currentWeekPicks: entry.currentWeekPicks.map((pick) => ({ ...pick })),
    })),
  };
}
