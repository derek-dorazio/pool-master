/**
 * BALLDONTLIE's normalized game lifecycle (`CompetitionStatusState`), which every league's
 * document shares, and what PoolMaster reads from it (#1496): how far a game has got, for an
 * event's status, and the game state the GAME live-score category carries.
 */

import { ProviderGameState } from '@poolmaster/shared/domain';
import { z } from 'zod';
import type { SportEvent } from '../../core/provider-interface';

/** The vendor's normalized lifecycle state (`CompetitionStatusState`). */
export const CompetitionStatusState = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  FINAL: 'final',
  POSTPONED: 'postponed',
  CANCELED: 'canceled',
  DELAYED: 'delayed',
  SUSPENDED: 'suspended',
  ABANDONED: 'abandoned',
  UNKNOWN: 'unknown',
} as const;
export type CompetitionStatusState = (typeof CompetitionStatusState)[keyof typeof CompetitionStatusState];

export const competitionStatusStateSchema = z.enum(CompetitionStatusState);

/** What a game's state says about the event it is part of. */
export const GameProgress = {
  NOT_STARTED: 'NOT_STARTED',
  POSTPONED: 'POSTPONED',
  LIVE: 'LIVE',
  FINAL: 'FINAL',
  CALLED_OFF: 'CALLED_OFF',
} as const;
export type GameProgress = (typeof GameProgress)[keyof typeof GameProgress];

export const PROGRESS_BY_STATE: Readonly<Record<CompetitionStatusState, GameProgress>> = {
  [CompetitionStatusState.SCHEDULED]: GameProgress.NOT_STARTED,
  // `unknown` "cannot be safely classified": such a game neither starts nor finishes its event.
  [CompetitionStatusState.UNKNOWN]: GameProgress.NOT_STARTED,
  [CompetitionStatusState.POSTPONED]: GameProgress.POSTPONED,
  // A delay or suspension pauses a game that has started; it resumes, so it is live.
  [CompetitionStatusState.IN_PROGRESS]: GameProgress.LIVE,
  [CompetitionStatusState.DELAYED]: GameProgress.LIVE,
  [CompetitionStatusState.SUSPENDED]: GameProgress.LIVE,
  [CompetitionStatusState.FINAL]: GameProgress.FINAL,
  [CompetitionStatusState.CANCELED]: GameProgress.CALLED_OFF,
  [CompetitionStatusState.ABANDONED]: GameProgress.CALLED_OFF,
};

/** Whether a game is over, by a result or by being called off. */
export function isDone(progress: GameProgress): boolean {
  return progress === GameProgress.FINAL || progress === GameProgress.CALLED_OFF;
}

/**
 * An event's status from its games' progress, `complete` saying whether every game the event
 * will have is listed. A game called off counts toward the end of its event, never toward its
 * start.
 */
export function eventStatusOf(progress: readonly GameProgress[], complete: boolean): SportEvent['status'] {
  if (progress.every(isDone) && complete) {
    return progress.includes(GameProgress.FINAL) ? 'COMPLETED' : 'CANCELLED';
  }
  if (progress.some((each) => each === GameProgress.FINAL || each === GameProgress.LIVE)) return 'IN_PROGRESS';
  return progress.every((each) => each === GameProgress.POSTPONED) ? 'POSTPONED' : 'SCHEDULED';
}

/** The game state each vendor state reports; `unknown` has none, and its game is left out. */
export const GAME_STATE_BY_STATUS: Readonly<Record<Exclude<CompetitionStatusState, 'unknown'>, ProviderGameState>> = {
  [CompetitionStatusState.SCHEDULED]: ProviderGameState.SCHEDULED,
  [CompetitionStatusState.IN_PROGRESS]: ProviderGameState.IN_PROGRESS,
  [CompetitionStatusState.DELAYED]: ProviderGameState.IN_PROGRESS,
  [CompetitionStatusState.SUSPENDED]: ProviderGameState.IN_PROGRESS,
  [CompetitionStatusState.FINAL]: ProviderGameState.FINAL,
  [CompetitionStatusState.POSTPONED]: ProviderGameState.POSTPONED,
  [CompetitionStatusState.CANCELED]: ProviderGameState.CANCELLED,
  [CompetitionStatusState.ABANDONED]: ProviderGameState.CANCELLED,
};

/** Whether a game in this state has a score worth reading: one before tip-off means nothing. */
export function hasStarted(state: ProviderGameState): boolean {
  return state === ProviderGameState.IN_PROGRESS || state === ProviderGameState.FINAL;
}
