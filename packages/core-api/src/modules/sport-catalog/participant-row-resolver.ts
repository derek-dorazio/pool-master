/**
 * The one resolver for a result row that names a participant of an event's field (#236): a
 * test event's golf round scores and race results.
 *
 * Precedence: `participantId`, then `externalId` (a feed id one of the participant's provider
 * mappings holds). A participant is never matched by name (#2114). Only the first identifier
 * present is used; a row whose first identifier matches nothing is unresolved, not retried on the
 * next. One candidate is a match, several are ambiguous, none is unresolved.
 */

import type { ParticipantMatchQuery, ParticipantProviderMappingRepository } from '@poolmaster/shared/db';
import type { Participant } from '@poolmaster/shared/domain';

/** Each candidate's feed ids by participant id: a participant's feed ids are its provider mappings' (#2040). */
export type FeedIdsByParticipant = ReadonlyMap<string, ReadonlySet<string>>;

export interface ParticipantRowIdentifiers {
  participantId?: string;
  externalId?: string;
}

export type ParticipantRowResolution = 'MATCHED' | 'UNRESOLVED' | 'AMBIGUOUS';

export interface ResolvedParticipantRow {
  resolution: ParticipantRowResolution;
  /** Set only when resolution is MATCHED. */
  participant: Participant | null;
}

/** The one identifier of a row that is matched, by the precedence above; null when it gives none. */
function participantMatchQuery(row: ParticipantRowIdentifiers): ParticipantMatchQuery | null {
  return row.participantId
    ? { id: row.participantId }
    : row.externalId
      ? { externalId: row.externalId }
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
