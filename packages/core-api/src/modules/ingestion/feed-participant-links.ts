/**
 * The feed participants waiting as "needs linking" (#1824), and how a root admin resolves one.
 *
 * The sync links a feed participant on its own whenever there is one answer, and creates it when
 * there is none (`IngestionPersistence`). One whose name two or more of the site's participants
 * could be waits here instead. Resolving it maps its feed id, so the next sync links it on its
 * own, and writes its field row in every event that sent it at once.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AmbiguousFeedParticipantRepository, ParticipantProviderMappingRepository } from '@poolmaster/shared/db';
import type { AmbiguousFeedParticipant } from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import type { IngestionPersistence } from './persistence/ingestion-persistence';

/** How a root admin resolves one: link it to one of its candidates, or create it as a new participant. */
export type AmbiguousFeedParticipantResolution =
  | { resolution: 'LINK'; participantId: string }
  | { resolution: 'CREATE' };

export interface FeedParticipantLinkServiceDependencies {
  ambiguous: AmbiguousFeedParticipantRepository;
  mappings: Pick<ParticipantProviderMappingRepository, 'findByProviderExternalIds'>;
  persistence: Pick<IngestionPersistence, 'resolveAmbiguousFeedParticipant'>;
  logger?: FastifyBaseLogger;
}

export class FeedParticipantLinkService {
  constructor(private readonly deps: FeedParticipantLinkServiceDependencies) {}

  /** The open ones, of one sport league when given, oldest first. */
  async listOpen(filter: { sportLeagueId?: string }): Promise<AmbiguousFeedParticipant[]> {
    return this.deps.ambiguous.listOpen(filter);
  }

  /**
   * Resolves one: refused when there is no such row (404), it is resolved already (409), the
   * pick is not one of its candidates (422), or its feed id was mapped by some other way since
   * (409, as the next sync will have settled it). Answers the row as resolved.
   */
  async resolve(id: string, choice: AmbiguousFeedParticipantResolution): Promise<AmbiguousFeedParticipant> {
    const row = await this.deps.ambiguous.findById(id);
    if (!row) throw new FeedParticipantLinkError(`No feed participant needing linking has id ${id}.`, 'FEED_PARTICIPANT_LINK_NOT_FOUND', 404);
    if (row.resolvedAt !== null) {
      throw new FeedParticipantLinkError(`${row.feedName} (${row.providerId} ${row.externalId}) was resolved already.`, 'FEED_PARTICIPANT_LINK_RESOLVED', 409);
    }
    if (choice.resolution === 'LINK' && !row.candidates.some((candidate) => candidate.participantId === choice.participantId)) {
      throw new FeedParticipantLinkError(
        `Participant ${choice.participantId} is not one of the candidates for ${row.feedName}.`,
        'FEED_PARTICIPANT_NOT_A_CANDIDATE',
        422,
      );
    }
    const mapped = (await this.deps.mappings.findByProviderExternalIds(row.providerId, [row.externalId])).at(0);
    if (mapped) {
      throw new FeedParticipantLinkError(
        `${row.providerId} ${row.externalId} is mapped to participant ${mapped.participantId} already.`,
        'FEED_PARTICIPANT_ALREADY_MAPPED',
        409,
      );
    }
    const { participantId, fieldRowsWritten } = await this.deps.persistence.resolveAmbiguousFeedParticipant(
      id,
      choice.resolution === 'LINK' ? choice.participantId : null,
    );
    this.deps.logger?.info({ ambiguousFeedParticipantId: id, resolution: choice.resolution, participantId, fieldRowsWritten }, 'Resolved feed participant needing linking');
    const resolved = await this.deps.ambiguous.findById(id);
    // The row was read above and resolving never deletes it; only a concurrent delete of its league could.
    if (!resolved) throw new FeedParticipantLinkError(`No feed participant needing linking has id ${id}.`, 'FEED_PARTICIPANT_LINK_NOT_FOUND', 404);
    return resolved;
  }
}

export class FeedParticipantLinkError extends Error {
  constructor(message: string, readonly code: ApiErrorCode, readonly statusCode: 404 | 409 | 422) {
    super(message);
    this.name = 'FeedParticipantLinkError';
  }
}
