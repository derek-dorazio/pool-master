/**
 * DraftStore — in-memory Map-backed storage for draft sessions and state.
 *
 * Temporary implementation until the draft flow is fully persistence-backed.
 */

import type { ServiceLogger } from '../../../core/logger';
import type { DraftState } from '../engine/snake-draft-engine';
import type { SessionState } from '../engine/draft-session-manager';

export class DraftStore {
  public constructor(private readonly logger?: ServiceLogger) {}

  private sessions: Map<string, SessionState> = new Map();
  private states: Map<string, DraftState> = new Map();
  private availableParticipants: Map<string, string[]> = new Map();

  /** Store or update a session for a contest. */
  async setSession(contestId: string, session: SessionState): Promise<void> {
    this.sessions.set(contestId, session);
    this.logger?.info(
      { action: 'draftStore.setSession', data: { contestId, sessionId: session.sessionId, status: session.status } },
      'Stored draft session',
    );
  }

  /** Retrieve the session for a contest. */
  async getSession(contestId: string): Promise<SessionState | undefined> {
    const session = this.sessions.get(contestId);
    this.logger?.debug(
      { action: 'draftStore.getSession', data: { contestId, found: Boolean(session) } },
      'Loaded draft session from store',
    );
    return session;
  }

  /** Store or update draft state for a contest. */
  async setState(contestId: string, state: DraftState): Promise<void> {
    this.states.set(contestId, state);
    this.logger?.info(
      {
        action: 'draftStore.setState',
        data: {
          contestId,
          status: state.status,
          currentPickNumber: state.currentPickNumber,
          pickCount: state.picks.length,
        },
      },
      'Stored draft state',
    );
  }

  /** Retrieve draft state for a contest. */
  async getState(contestId: string): Promise<DraftState | undefined> {
    const state = this.states.get(contestId);
    this.logger?.debug(
      { action: 'draftStore.getState', data: { contestId, found: Boolean(state) } },
      'Loaded draft state from store',
    );
    return state;
  }

  /** Set the available participant pool for a contest. */
  async setAvailableParticipants(contestId: string, participantIds: string[]): Promise<void> {
    this.availableParticipants.set(contestId, [...participantIds]);
    this.logger?.info(
      { action: 'draftStore.setAvailableParticipants', data: { contestId, participantCount: participantIds.length } },
      'Stored available draft participants',
    );
  }

  /** Get the available participant pool for a contest. */
  async getAvailableParticipants(contestId: string): Promise<string[]> {
    const participantIds = this.availableParticipants.get(contestId) ?? [];
    this.logger?.debug(
      { action: 'draftStore.getAvailableParticipants', data: { contestId, participantCount: participantIds.length } },
      'Loaded available draft participants',
    );
    return participantIds;
  }

  /** Check if a draft session exists for a contest. */
  has(contestId: string): boolean {
    const exists = this.sessions.has(contestId);
    this.logger?.debug(
      { action: 'draftStore.has', data: { contestId, exists } },
      'Checked draft session existence',
    );
    return exists;
  }

  /** Remove all data for a contest. */
  async remove(contestId: string): Promise<void> {
    this.sessions.delete(contestId);
    this.states.delete(contestId);
    this.availableParticipants.delete(contestId);
    this.logger?.info(
      { action: 'draftStore.remove', data: { contestId } },
      'Removed draft state from store',
    );
  }

  /** Clear all stored data — useful for testing. */
  clear(): void {
    this.sessions.clear();
    this.states.clear();
    this.availableParticipants.clear();
    this.logger?.warn({ action: 'draftStore.clearAll' }, 'Cleared all in-memory draft state');
  }
}

export const draftStore = new DraftStore();
