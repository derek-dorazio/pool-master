/**
 * A bracket contest's leaderboard → DTO (#721). `ContestService.getBracketLeaderboard` answers
 * with a `BracketLeaderboardModel`; the published `BracketLeaderboardResponse` is shaped here.
 */

import type { BracketLeaderboardResponse } from '@poolmaster/shared/dto';

export interface BracketLeaderboardEntryRow {
  entryId: string;
  entryName: string;
  entryNumber: number;
  squadId: string;
  squadName: string;
  position: number;
  displayPosition: string;
  points: number;
  maxPossiblePoints: number;
  correctPickCount: number;
  tiebreakerValue: number | null;
}

export interface BracketLeaderboardModel {
  contestId: string;
  sportEventId: string;
  eventCancelled: boolean;
  gameCount: number;
  finalTotalPoints: number | null;
  entries: BracketLeaderboardEntryRow[];
}

export function toBracketLeaderboardResponse(model: BracketLeaderboardModel): BracketLeaderboardResponse {
  return {
    contestId: model.contestId,
    sportEventId: model.sportEventId,
    eventCancelled: model.eventCancelled,
    gameCount: model.gameCount,
    finalTotalPoints: model.finalTotalPoints,
    entries: model.entries.map((entry) => ({ ...entry })),
  };
}
