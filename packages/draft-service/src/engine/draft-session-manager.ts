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
  pickDeadline: Date | null;
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
): TransitionResult {
  const allowed = VALID_TRANSITIONS[current.status];

  if (!allowed.includes(targetStatus)) {
    return {
      success: false,
      reason: `Cannot transition from ${current.status} to ${targetStatus}`,
    };
  }

  return { success: true, newStatus: targetStatus };
}

/**
 * Start a draft session. Transitions from PENDING to LIVE.
 */
export function startSession(session: SessionState): SessionState {
  const result = transitionSession(session, 'LIVE');
  if (!result.success) {
    throw new Error(result.reason);
  }

  const now = new Date();
  return {
    ...session,
    status: 'LIVE',
    currentPickNumber: 1,
    startedAt: now,
    pickDeadline: new Date(now.getTime() + session.timePerPickSeconds * 1000),
  };
}

/**
 * Pause a draft session. Transitions from LIVE to PAUSED.
 */
export function pauseSession(session: SessionState): SessionState {
  const result = transitionSession(session, 'PAUSED');
  if (!result.success) {
    throw new Error(result.reason);
  }

  return {
    ...session,
    status: 'PAUSED',
    pickDeadline: null,
  };
}

/**
 * Resume a draft session. Transitions from PAUSED to LIVE.
 */
export function resumeSession(session: SessionState): SessionState {
  const result = transitionSession(session, 'LIVE');
  if (!result.success) {
    throw new Error(result.reason);
  }

  return {
    ...session,
    status: 'LIVE',
    pickDeadline: new Date(Date.now() + session.timePerPickSeconds * 1000),
  };
}

/**
 * Complete a draft session. Transitions to COMPLETE.
 */
export function completeSession(session: SessionState): SessionState {
  const result = transitionSession(session, 'COMPLETE');
  if (!result.success) {
    throw new Error(result.reason);
  }

  return {
    ...session,
    status: 'COMPLETE',
    pickDeadline: null,
  };
}

/**
 * Extend the pick deadline by additional seconds.
 * Commissioner control — only valid when LIVE.
 */
export function extendPickDeadline(
  session: SessionState,
  additionalSeconds: number,
): SessionState {
  if (session.status !== 'LIVE') {
    throw new Error(`Cannot extend deadline when status is ${session.status}`);
  }

  if (!session.pickDeadline) {
    throw new Error('No pick deadline to extend');
  }

  return {
    ...session,
    pickDeadline: new Date(session.pickDeadline.getTime() + additionalSeconds * 1000),
  };
}

/**
 * Check if the current pick has expired (timer ran out).
 */
export function isPickExpired(session: SessionState): boolean {
  if (session.status !== 'LIVE' || !session.pickDeadline) {
    return false;
  }
  return new Date() > session.pickDeadline;
}
