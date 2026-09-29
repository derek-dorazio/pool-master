/**
 * The one resolver for an uploaded row that names a participant (#236). Two uploads use
 * it — a sport league's affiliation rankings and an event's round scores — and they
 * differ only in where candidates come from: the sport's whole catalog, or the event's
 * field. Before #236 each carried its own copy of the precedence below.
 *
 * Precedence: `participantId`, then `externalId`, then an exact case-insensitive
 * `playerName`. Only the first identifier present is used; a row whose first identifier
 * matches nothing is unresolved, not retried on the next. One candidate is a match,
 * several are ambiguous, none is unresolved.
 */

import type { ParticipantMatchQuery } from '@poolmaster/shared/db';
import type { Participant } from '@poolmaster/shared/domain';

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

export async function resolveParticipantRow(
  row: ParticipantRowIdentifiers,
  findCandidates: (query: ParticipantMatchQuery) => Promise<Participant[]>,
): Promise<ResolvedParticipantRow> {
  const query: ParticipantMatchQuery | null = row.participantId
    ? { id: row.participantId }
    : row.externalId
      ? { externalId: row.externalId }
      : row.playerName
        ? { name: row.playerName }
        : null;
  if (!query) {
    return { resolution: 'UNRESOLVED', participant: null };
  }
  const matches = await findCandidates(query);
  if (matches.length === 1) {
    return { resolution: 'MATCHED', participant: matches[0] };
  }
  return { resolution: matches.length > 1 ? 'AMBIGUOUS' : 'UNRESOLVED', participant: null };
}

/** The same match rule over candidates already in hand — an event's field. */
export function matchAmong(candidates: readonly Participant[]) {
  return (query: ParticipantMatchQuery): Promise<Participant[]> => Promise.resolve(candidates.filter((candidate) => (
    (query.id === undefined || candidate.id === query.id)
    && (query.externalId === undefined || candidate.externalId === query.externalId)
    && (query.name === undefined || candidate.name.toLowerCase() === query.name.toLowerCase())
  )));
}
