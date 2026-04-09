/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and rankings received from data providers.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderRanking,
} from '../core/provider-interface';

export class IngestionPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Upsert sport events by (providerId, externalId).
   * Returns the number of events persisted.
   */
  async persistEvents(events: SportEvent[]): Promise<number> {
    let count = 0;

    for (const event of events) {
      await this.prisma.sportEvent.upsert({
        where: {
          providerId_externalId: {
            providerId: event.providerId,
            externalId: event.externalId,
          },
        },
        create: {
          externalId: event.externalId,
          providerId: event.providerId,
          sport: event.sport,
          name: event.name,
          venue: event.venue ?? null,
          location: event.location ?? null,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          status: event.status,
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          fieldLocked: event.fieldLocked,
          metadata: event.metadata as any,
        },
        update: {
          name: event.name,
          venue: event.venue ?? null,
          location: event.location ?? null,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          status: event.status,
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          fieldLocked: event.fieldLocked,
          metadata: event.metadata as any,
        },
      });
      count++;
    }

    return count;
  }

  /**
   * Upsert participants by external ID via the provider mapping table.
   *
   * For each provider participant:
   * 1. Look up ParticipantProviderMapping by (providerId, externalId)
   * 2. If found — update the linked Participant record
   * 3. If not found — resolve the Sport, create a new Participant + mapping
   *
   * Returns the number of participants persisted.
   */
  async persistParticipants(participants: ProviderParticipant[]): Promise<number> {
    let count = 0;

    for (const p of participants) {
      const mapping = await this.prisma.participantProviderMapping.findUnique({
        where: {
          providerId_externalId: {
            providerId: p.providerId,
            externalId: p.externalId,
          },
        },
        include: { participant: true },
      });

      if (mapping) {
        // Update existing participant
        await this.prisma.participant.update({
          where: { id: mapping.participantId },
          data: {
            name: p.name,
            firstName: p.firstName ?? null,
            lastName: p.lastName ?? null,
            nationality: p.nationality ?? null,
            position: p.position ?? null,
            teamAffiliation: p.teamAffiliation ?? null,
            photoUrl: p.photoUrl ?? null,
            status: p.active ? 'ACTIVE' : 'INACTIVE',
            metadata: p.metadata as any,
          },
        });
      } else {
        // Resolve the Sport row — find or create by name
        const sport = await this.prisma.sport.upsert({
          where: { name: p.sport },
          create: {
            name: p.sport,
            participantType: 'INDIVIDUAL',
          },
          update: {},
        });

        // Create participant + provider mapping in a transaction
        await this.prisma.$transaction(async (tx) => {
          const participant = await tx.participant.create({
            data: {
              sportId: sport.id,
              name: p.name,
              participantType: sport.participantType,
              externalId: p.externalId,
              firstName: p.firstName ?? null,
              lastName: p.lastName ?? null,
              nationality: p.nationality ?? null,
              position: p.position ?? null,
              teamAffiliation: p.teamAffiliation ?? null,
              photoUrl: p.photoUrl ?? null,
              status: p.active ? 'ACTIVE' : 'INACTIVE',
              metadata: p.metadata as any,
            },
          });

          await tx.participantProviderMapping.create({
            data: {
              participantId: participant.id,
              providerId: p.providerId,
              externalId: p.externalId,
              confidence: 'EXACT',
            },
          });
        });
      }

      count++;
    }

    return count;
  }

  /**
   * Persist a full event detail payload and link the event-scoped participants.
   *
   * This is the first-pass bridge between provider event detail responses and
   * the new event-participant model used by scoring and roster picks.
   */
  async persistEventDetail(detail: SportEventDetail): Promise<{
    eventsPersisted: number;
    participantsPersisted: number;
    sportEventParticipantsPersisted: number;
    sourceDataPersisted: number;
  }> {
    const eventsPersisted = await this.persistEvents([detail]);
    const participantsPersisted = await this.persistParticipants(detail.participants);

    const persistedEvent = await this.prisma.sportEvent.findUnique({
      where: {
        providerId_externalId: {
          providerId: detail.providerId,
          externalId: detail.externalId,
        },
      },
    });
    if (!persistedEvent) {
      throw new Error(
        `Persisted sport event not found for ${detail.providerId}:${detail.externalId}`,
      );
    }

    let sportEventParticipantsPersisted = 0;
    let sourceDataPersisted = 0;

    for (const participant of detail.participants) {
      const mapping = await this.prisma.participantProviderMapping.findUnique({
        where: {
          providerId_externalId: {
            providerId: participant.providerId,
            externalId: participant.externalId,
          },
        },
      });
      if (!mapping) {
        continue;
      }

      const sportEventParticipant = await this.prisma.sportEventParticipant.upsert({
        where: {
          sportEventId_participantId: {
            sportEventId: persistedEvent.id,
            participantId: mapping.participantId,
          },
        },
        create: {
          sportEventId: persistedEvent.id,
          participantId: mapping.participantId,
          status: participant.active ? 'ACTIVE' : 'INACTIVE',
          metadata: participant.metadata as any,
        },
        update: {
          status: participant.active ? 'ACTIVE' : 'INACTIVE',
          metadata: participant.metadata as any,
        },
      });

      sportEventParticipantsPersisted++;

      await this.prisma.sportEventParticipantSourceData.create({
        data: {
          sportEventParticipantId: sportEventParticipant.id,
          providerId: participant.providerId,
          externalId: participant.externalId,
          rawPayload: {
            externalId: participant.externalId,
            providerId: participant.providerId,
            sport: participant.sport,
            name: participant.name,
            firstName: participant.firstName ?? null,
            lastName: participant.lastName ?? null,
            nationality: participant.nationality ?? null,
            position: participant.position ?? null,
            teamAffiliation: participant.teamAffiliation ?? null,
            photoUrl: participant.photoUrl ?? null,
            active: participant.active,
            metadata: participant.metadata,
          } as any,
          normalizedData: participant.metadata as any,
          receivedAt: new Date(),
        },
      });
      sourceDataPersisted++;
    }

    return {
      eventsPersisted,
      participantsPersisted,
      sportEventParticipantsPersisted,
      sourceDataPersisted,
    };
  }

  /**
   * Upsert rankings into ParticipantSeasonRecord.
   *
   * For each ranking:
   * 1. Resolve participant via ParticipantProviderMapping
   * 2. Determine the current season string from asOfDate
   * 3. Upsert the season record with updated ranking data
   *
   * Returns the number of rankings persisted.
   */
  async persistRankings(rankings: ProviderRanking[]): Promise<number> {
    let count = 0;

    for (const r of rankings) {
      // We need the providerId from context — rankings reference participantExternalId
      // but don't carry providerId. Look up by externalId across all providers.
      const mapping = await this.prisma.participantProviderMapping.findFirst({
        where: { externalId: r.participantExternalId },
        include: { participant: { include: { sport: true } } },
      });

      if (!mapping) {
        // Skip rankings for unknown participants — they will be persisted
        // once the participant sync runs.
        continue;
      }

      const season = String(r.asOfDate.getFullYear());
      const sportName = mapping.participant.sport.name;

      // Build the ranking entry to merge into the rankings JSON array
      const rankingEntry = {
        type: r.rankingType,
        rank: r.rank,
        points: r.points ?? null,
        asOfDate: r.asOfDate.toISOString(),
      };

      // Upsert the season record
      const existing = await this.prisma.participantSeasonRecord.findUnique({
        where: {
          participantId_season: {
            participantId: mapping.participantId,
            season,
          },
        },
      });

      if (existing) {
        // Merge ranking into existing rankings array
        const currentRankings = (existing.rankings as any[]) ?? [];
        const idx = currentRankings.findIndex(
          (entry: any) => entry.type === r.rankingType,
        );
        if (idx >= 0) {
          currentRankings[idx] = rankingEntry;
        } else {
          currentRankings.push(rankingEntry);
        }

        await this.prisma.participantSeasonRecord.update({
          where: { id: existing.id },
          data: {
            rankings: currentRankings as any,
            lastUpdated: new Date(),
          },
        });
      } else {
        await this.prisma.participantSeasonRecord.create({
          data: {
            participantId: mapping.participantId,
            sport: sportName,
            season,
            rankings: [rankingEntry] as any,
            lastUpdated: new Date(),
          },
        });
      }

      count++;
    }

    return count;
  }
}
