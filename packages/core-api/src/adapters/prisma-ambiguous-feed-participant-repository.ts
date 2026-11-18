/**
 * Prisma adapter for AmbiguousFeedParticipantRepository (#1824): the feed participants waiting as
 * "needs linking". The sync writes the rows (`IngestionPersistence`); this reads and settles them.
 */

import type { PrismaClient } from '@prisma/client';
import type { AmbiguousFeedParticipantRepository } from '@poolmaster/shared/db';
import type { AmbiguousFeedParticipant } from '@poolmaster/shared/domain';

const ROW_INCLUDE = {
  sightings: { select: { sportEvent: { select: { id: true, name: true, startDate: true } } } },
} as const;

type Row = {
  id: string;
  sportLeagueId: string;
  providerId: string;
  externalId: string;
  feedName: string;
  candidateParticipantIds: string[];
  resolvedAt: Date | null;
  resolvedParticipantId: string | null;
  createdAt: Date;
  updatedAt: Date;
  sightings: Array<{ sportEvent: { id: string; name: string; startDate: Date } }>;
};

export class PrismaAmbiguousFeedParticipantRepository implements AmbiguousFeedParticipantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** The open rows with their sightings' events, then every candidate's name in one read. */
  async listOpen(filter: { sportLeagueId?: string }): Promise<AmbiguousFeedParticipant[]> {
    const rows = await this.prisma.ambiguousFeedParticipant.findMany({
      where: { resolvedAt: null, ...(filter.sportLeagueId === undefined ? {} : { sportLeagueId: filter.sportLeagueId }) },
      include: ROW_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { feedName: 'asc' }, { id: 'asc' }],
    });
    return this.withCandidates(rows);
  }

  async findById(id: string): Promise<AmbiguousFeedParticipant | null> {
    const row = await this.prisma.ambiguousFeedParticipant.findUnique({ where: { id }, include: ROW_INCLUDE });
    return row ? (await this.withCandidates([row]))[0] : null;
  }

  async countOpenForEvent(sportEventId: string): Promise<number> {
    return this.prisma.ambiguousFeedParticipantSighting.count({
      where: { sportEventId, ambiguousFeedParticipant: { resolvedAt: null } },
    });
  }

  async resolveFeedId(providerId: string, externalId: string, participantId: string, at: Date): Promise<void> {
    await this.prisma.ambiguousFeedParticipant.updateMany({
      where: { providerId, externalId, resolvedAt: null },
      data: { resolvedAt: at, resolvedParticipantId: participantId },
    });
  }

  /** The rows as domain objects, their candidates named from one read; a candidate deleted since is left out. */
  private async withCandidates(rows: readonly Row[]): Promise<AmbiguousFeedParticipant[]> {
    const candidateIds = [...new Set(rows.flatMap((row) => row.candidateParticipantIds))];
    const names = new Map((candidateIds.length === 0 ? [] : await this.prisma.participant.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, name: true },
    })).map((participant) => [participant.id, participant.name]));
    return rows.map((row) => ({
      id: row.id,
      sportLeagueId: row.sportLeagueId,
      providerId: row.providerId,
      externalId: row.externalId,
      feedName: row.feedName,
      candidates: row.candidateParticipantIds.flatMap((participantId) => {
        const name = names.get(participantId);
        return name === undefined ? [] : [{ participantId, name }];
      }),
      events: row.sightings
        .map(({ sportEvent }) => ({ sportEventId: sportEvent.id, name: sportEvent.name, startDate: sportEvent.startDate }))
        .sort((one, other) => one.startDate.getTime() - other.startDate.getTime() || one.sportEventId.localeCompare(other.sportEventId)),
      resolvedAt: row.resolvedAt,
      resolvedParticipantId: row.resolvedParticipantId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
