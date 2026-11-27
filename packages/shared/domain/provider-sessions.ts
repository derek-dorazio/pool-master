/**
 * The sessions a provider lists for a field event, and which of them the event plays as Rounds
 * (#2045, plans/league-model-redesign.md §3). A Formula 1 weekend has practice, qualifying, a
 * sprint and the race; pools run only on the race. Which sessions are played is mapping data,
 * never code: the league's session type provider mappings name the types it plays. Inclusion
 * only, so a session of a type no mapping names is not synced.
 *
 * This is the one place a session becomes a Round. The events sync numbers a new event's Rounds
 * here, and the live-score writer finds each session's Round here, so the two never disagree.
 */

/** One session of a provider event, as the provider's feed lists it. */
export interface ProviderSession {
  /** The provider's own id for the session. */
  providerSessionId: string;
  /** The session's type, exactly as the feed sends it ("Race"): what the session type mappings name. */
  sessionType: string;
  /** When the session starts; null while the provider has not scheduled it. */
  startsAt: Date | null;
}

/** A session the event plays as a Round, with that Round's number. */
export interface SessionRound<Session extends ProviderSession> {
  roundNumber: number;
  /** The session, which has a start: one with none is not numbered. */
  session: Session & { startsAt: Date };
}

/**
 * The sessions of `includedTypes`, numbered as the event's Rounds from 1 in the order they start.
 * A session with no start yet is left out: it cannot be scheduled, and numbering it would shift
 * every Round after it once it is.
 */
export function sessionRounds<Session extends ProviderSession>(
  sessions: readonly Session[],
  includedTypes: ReadonlySet<string>,
): SessionRound<Session>[] {
  return sessions
    .filter((session): session is Session & { startsAt: Date } => session.startsAt !== null && includedTypes.has(session.sessionType))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime() || left.providerSessionId.localeCompare(right.providerSessionId))
    .map((session, index) => ({ roundNumber: index + 1, session }));
}
