/**
 * DraftStore — in-memory Map-backed storage for draft sessions and state.
 *
 * Temporary implementation until the draft flow is fully persistence-backed.
 */

import type { DraftState } from '../engine/snake-draft-engine';
import type { SessionState } from '../engine/draft-session-manager';

export class DraftStore {
  private sessions: Map<string, SessionState> = new Map();
  private states: Map<string, DraftState> = new Map();
  private availableParticipants: Map<string, string[]> = new Map();

  /** Store or update a session for a contest. */
  async setSession(contestId: string, session: SessionState): Promise<void> {
    this.sessions.set(contestId, session);
  }

  /** Retrieve the session for a contest. */
  async getSession(contestId: string): Promise<SessionState | undefined> {
    return this.sessions.get(contestId);
  }

  /** Store or update draft state for a contest. */
  async setState(contestId: string, state: DraftState): Promise<void> {
    this.states.set(contestId, state);
  }

  /** Retrieve draft state for a contest. */
  async getState(contestId: string): Promise<DraftState | undefined> {
    return this.states.get(contestId);
  }

  /** Set the available participant pool for a contest. */
  async setAvailableParticipants(contestId: string, participantIds: string[]): Promise<void> {
    this.availableParticipants.set(contestId, [...participantIds]);
  }

  /** Get the available participant pool for a contest. */
  async getAvailableParticipants(contestId: string): Promise<string[]> {
    return this.availableParticipants.get(contestId) ?? [];
  }

  /** Check if a draft session exists for a contest. */
  has(contestId: string): boolean {
    return this.sessions.has(contestId);
  }

  /** Remove all data for a contest. */
  async remove(contestId: string): Promise<void> {
    this.sessions.delete(contestId);
    this.states.delete(contestId);
    this.availableParticipants.delete(contestId);
  }

  /** Clear all stored data — useful for testing. */
  clear(): void {
    this.sessions.clear();
    this.states.clear();
    this.availableParticipants.clear();
  }
}

export const draftStore = new DraftStore();
