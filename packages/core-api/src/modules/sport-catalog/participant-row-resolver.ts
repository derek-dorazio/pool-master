/**
 * The one resolver for an uploaded row that names a participant (#236). Two uploads use
 * it — a sport league's participant rankings and an event's round scores — and they
 * differ only in where candidates come from: the sport's whole catalog, or the event's
 * field. Before #236 each carried its own copy of the precedence below.
 *
 * Precedence: `participantId`, then `externalId`, then an exact case-insensitive
 * `playerName`. Only the first identifier present is used; a row whose first identifier
 * matches nothing is unresolved, not retried on the next. One candidate is a match,
 * several are ambiguous, none is unresolved.
 */

import type { ParticipantMatchQuery, ParticipantProviderMappingRepository } from '@poolmaster/shared/db';
import type { Participant } from '@poolmaster/shared/domain';

/** Each candidate's feed ids by participant id: a participant's feed ids are its provider mappings' (#2040). */
export type FeedIdsByParticipant = ReadonlyMap<string, ReadonlySet<string>>;

export interface ParticipantRowIdentifiers {
  participantId?: string;
  externalId?: string;
  playerName?: string;
}

export type ParticipantRowResolution = 'MATCHED' | 'UNRESOLVED' | 'AMBIGUOUS';

export interface ResolvedParticipantRow {
  resolution: ParticipantRowResolution;
  /** Set only when resolution is MATCHED. */
  participant: Participant | null;
}

/** The one identifier of a row that is matched, by the precedence above; null when it gives none. */
export function participantMatchQuery(row: ParticipantRowIdentifiers): ParticipantMatchQuery | null {
  return row.participantId
    ? { id: row.participantId }
    : row.externalId
      ? { externalId: row.externalId }
      : row.playerName
        ? { name: row.playerName }
        : null;
}

export async function resolveParticipantRow(
  row: ParticipantRowIdentifiers,
  findCandidates: (query: ParticipantMatchQuery) => Promise<Participant[]>,
): Promise<ResolvedParticipantRow> {
  const query = participantMatchQuery(row);
  if (!query) {
    return { resolution: 'UNRESOLVED', participant: null };
  }
  const candidates = await findCandidates(query);
  if (candidates.length === 1) {
    const [candidate] = candidates;
    return { resolution: 'MATCHED', participant: candidate };
  }
  return { resolution: candidates.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED', participant: null };
}

/**
 * The same match rule over candidates already in hand: an event's field, or an upload's candidates
 * read at once. A row naming a feed id matches a candidate one of whose provider mappings holds it
 * (`feedIdsOfCandidates`).
 */
export function matchAmong(candidates: readonly Participant[], feedIds: FeedIdsByParticipant = new Map()) {
  return (query: ParticipantMatchQuery): Promise<Participant[]> => Promise.resolve(candidates.filter((candidate) => (
    (query.id === undefined || candidate.id === query.id)
    && (query.externalId === undefined || (feedIds.get(candidate.id)?.has(query.externalId) ?? false))
    && (query.name === undefined || candidate.name.toLowerCase() === query.name.toLowerCase())
  )));
}

/**
 * The candidates' feed ids, in one read, for the rows that are matched by one; no read when no row
 * is (`participantMatchQuery`).
 */
export async function feedIdsOfCandidates(
  rows: readonly ParticipantRowIdentifiers[],
  candidates: readonly Participant[],
  mappings: Pick<ParticipantProviderMappingRepository, 'findByParticipantIds'>,
): Promise<FeedIdsByParticipant> {
  const byFeedId = rows.some((row) => participantMatchQuery(row)?.externalId !== undefined);
  if (!byFeedId || candidates.length === 0) return new Map();
  const feedIds = new Map<string, Set<string>>();
  for (const mapping of await mappings.findByParticipantIds(candidates.map((candidate) => candidate.id))) {
    feedIds.set(mapping.participantId, (feedIds.get(mapping.participantId) ?? new Set()).add(mapping.externalId));
  }
  return feedIds;
}
