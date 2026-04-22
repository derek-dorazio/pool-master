/**
 * Draft Session Manager.
 *
 * Manages the lifecycle state machine for a draft session:
 *   PENDING → LIVE → PAUSED → LIVE → COMPLETE
 *
 * Coordinates the SnakeDraftEngine with session persistence
 * and commissioner controls.
 */

import type { DraftStatus } from '@poolmaster/shared/domain';
import type { ServiceLogger } from '../../../core/logger';

// --- State Machine ---

const VALID_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  PENDING: ['LIVE'],
  LIVE: ['PAUSED', 'COMPLETE'],
  PAUSED: ['LIVE', 'COMPLETE'],
  COMPLETE: [],
};

export interface SessionState {
  sessionId: string;
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId: string | null;
  startedAt: Date | null;
  currentTurnStartedAt: Date | null;
  timePerPickSeconds: number;
}

export interface TransitionResult {
  success: boolean;
  newStatus?: DraftStatus;
  reason?: string;
}

/**
 * Attempt a state transition on a draft session.
 */
export function transitionSession(
  current: SessionState,
  targetStatus: DraftStatus,
  logger?: ServiceLogger,
): TransitionResult {
  logger?.debug(
    { action: 'draftSession.transition.start', data: { sessionId: current.sessionId, contestId: current.contestId, currentStatus: current.status, targetStatus } },
    'Attempting draft session transition',
  );
  const allowed = VALID_TRANSITIONS[current.status];

  if (!allowed.includes(targetStatus)) {
    logger?.warn(
      { action: 'draftSession.transition.invalid', data: { sessionId: current.sessionId, contestId: current.contestId, currentStatus: current.status, targetStatus } },
      'Rejected invalid draft session transition',
    );
    return {
      success: false,
      reason: `Cannot transition from ${current.status} to ${targetStatus}`,
    };
  }

  logger?.info(
    { action: 'draftSession.transition.success', data: { sessionId: current.sessionId, contestId: current.contestId, currentStatus: current.status, targetStatus } },
    'Validated draft session transition',
  );
  return { success: true, newStatus: targetStatus };
}

/**
 * Start a draft session. Transitions from PENDING to LIVE.
 */
export function startSession(session: SessionState, logger?: ServiceLogger): SessionState {
  const result = transitionSession(session, 'LIVE', logger);
  if (!result.success) {
    logger?.error(
      { action: 'draftSession.start.invalid', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status } },
      'Draft session start failed because the transition was invalid',
    );
    throw new Error(result.reason);
  }

  const now = new Date();
  const liveSession: SessionState = {
    ...session,
    status: 'LIVE',
    currentPickNumber: 1,
    startedAt: now,
    currentTurnStartedAt: now,
  };
  logger?.info(
    { action: 'draftSession.start.success', data: { sessionId: session.sessionId, contestId: session.contestId, startedAt: now.toISOString() } },
    'Started draft session',
  );
  return liveSession;
}

/**
 * Pause a draft session. Transitions from LIVE to PAUSED.
 */
export function pauseSession(session: SessionState, logger?: ServiceLogger): SessionState {
  const result = transitionSession(session, 'PAUSED', logger);
  if (!result.success) {
    logger?.error(
      { action: 'draftSession.pause.invalid', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status } },
      'Draft session pause failed because the transition was invalid',
    );
    throw new Error(result.reason);
  }

  const pausedSession: SessionState = {
    ...session,
    status: 'PAUSED',
    currentTurnStartedAt: null,
  };
  logger?.info(
    { action: 'draftSession.pause.success', data: { sessionId: session.sessionId, contestId: session.contestId } },
    'Paused draft session',
  );
  return pausedSession;
}

/**
 * Resume a draft session. Transitions from PAUSED to LIVE.
 */
export function resumeSession(session: SessionState, logger?: ServiceLogger): SessionState {
  if (session.status !== 'PAUSED') {
    logger?.error(
      { action: 'draftSession.resume.invalidStatus', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status } },
      'Draft session resume failed because the session was not paused',
    );
    throw new Error(`Cannot resume from ${session.status} — session must be PAUSED`);
  }
  const result = transitionSession(session, 'LIVE', logger);
  if (!result.success) {
    logger?.error(
      { action: 'draftSession.resume.invalidTransition', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status } },
      'Draft session resume failed because the transition was invalid',
    );
    throw new Error(result.reason);
  }

  const resumedSession: SessionState = {
    ...session,
    status: 'LIVE',
    currentTurnStartedAt: new Date(),
  };
  logger?.info(
    { action: 'draftSession.resume.success', data: { sessionId: session.sessionId, contestId: session.contestId } },
    'Resumed draft session',
  );
  return resumedSession;
}

/**
 * Complete a draft session. Transitions to COMPLETE.
 */
export function completeSession(session: SessionState, logger?: ServiceLogger): SessionState {
  const result = transitionSession(session, 'COMPLETE', logger);
  if (!result.success) {
    logger?.error(
      { action: 'draftSession.complete.invalid', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status } },
      'Draft session completion failed because the transition was invalid',
    );
    throw new Error(result.reason);
  }

  const completedSession: SessionState = {
    ...session,
    status: 'COMPLETE',
    currentTurnStartedAt: null,
  };
  logger?.info(
    { action: 'draftSession.complete.success', data: { sessionId: session.sessionId, contestId: session.contestId } },
    'Completed draft session',
  );
  return completedSession;
}

/**
 * Extend the pick deadline by additional seconds.
 * Commissioner control — only valid when LIVE.
 */
export function extendCurrentTurn(
  session: SessionState,
  additionalSeconds: number,
  logger?: ServiceLogger,
): SessionState {
  if (session.status !== 'LIVE') {
    logger?.error(
      { action: 'draftSession.extend.invalidStatus', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status, additionalSeconds } },
      'Draft session turn extension failed because the session was not live',
    );
    throw new Error(`Cannot extend deadline when status is ${session.status}`);
  }

  if (!session.currentTurnStartedAt) {
    logger?.error(
      { action: 'draftSession.extend.missingTurnStart', data: { sessionId: session.sessionId, contestId: session.contestId, additionalSeconds } },
      'Draft session turn extension failed because there was no current turn start time',
    );
    throw new Error('No current turn start time to extend');
  }

  const extendedSession = {
    ...session,
    currentTurnStartedAt: new Date(
      session.currentTurnStartedAt.getTime() + additionalSeconds * 1000,
    ),
  };
  logger?.info(
    { action: 'draftSession.extend.success', data: { sessionId: session.sessionId, contestId: session.contestId, additionalSeconds } },
    'Extended current draft turn',
  );
  return extendedSession;
}

/**
 * Check if the current pick has expired (timer ran out).
 */
export function isPickExpired(session: SessionState, logger?: ServiceLogger): boolean {
  if (session.status !== 'LIVE' || !session.currentTurnStartedAt) {
    logger?.debug(
      { action: 'draftSession.isPickExpired.inactive', data: { sessionId: session.sessionId, contestId: session.contestId, status: session.status, hasCurrentTurnStart: Boolean(session.currentTurnStartedAt) } },
      'Draft pick expiry check short-circuited because the session is not actively on the clock',
    );
    return false;
  }
  const expired = new Date() > new Date(
    session.currentTurnStartedAt.getTime() + session.timePerPickSeconds * 1000,
  );
  logger?.info(
    { action: 'draftSession.isPickExpired.result', data: { sessionId: session.sessionId, contestId: session.contestId, expired, timePerPickSeconds: session.timePerPickSeconds } },
    'Evaluated draft pick expiry',
  );
  return expired;
}
