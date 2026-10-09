/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and event fields received from data providers.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { getDefaultTournamentFormatForSport, type SportEventStatus } from '@poolmaster/shared/domain';
import type {
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderParticipantMetadata,
} from '../core/provider-interface';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../core/sync-write-diagnostics';
import { summarizeSyncWriteRows } from '../core/sync-write-diagnostics';

interface PersistenceDiagnosticsResult<T> {
  count: number;
  value: T;
  writeDiagnostics: SyncWriteDiagnostics;
}

export class IngestionPersistence {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async persistEventsWithDiagnostics(
    events: SportEvent[],
  ): Promise<PersistenceDiagnosticsResult<number>> {
    let count = 0;
    const detailRows: SyncWriteDetailRow[] = [];
    this.logger?.debug({
      count: events.length,
      events: events.slice(0, 10).map((event) => ({
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        status: event.status,
        startDate: event.startDate.toISOString(),
      })),
    }, 'Persisting sport events from ingestion');

    for (const event of events) {
      const existingEvent = await this.prisma.sportEvent.findUnique({
        where: {
          providerId_externalId: {
            providerId: event.providerId,
            externalId: event.externalId,
          },
        },
      });
      if (!existingEvent) {
        this.logger?.info({
          providerId: event.providerId,
          externalId: event.externalId,
          name: event.name,
        }, 'Skipped provider event with no linked sport event');
        continue;
      }
      const before = normalizeSportEventRow(existingEvent);
      const participantCount = event.participantCount ?? existingEvent.participantCount;
      const after = { ...before, participantCount };

      const persistedEvent = await this.prisma.sportEvent.update({
        where: { id: existingEvent.id },
        data: { participantCount },
      });
      detailRows.push({
        id: `sport-event:${event.providerId}:${event.externalId}`,
        entityType: 'SportEvent',
        disposition: resolveDisposition(before, after),
        providerId: event.providerId,
        externalId: event.externalId,
        internalId: persistedEvent.id,
        name: event.name,
        before,
        after,
      });
      count++;
      this.logger?.debug({
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        participantCount,
      }, 'Persisted sport event from ingestion');
    }

    this.logger?.info({ count }, 'Persisted sport events from ingestion');
    return {
      count,
      value: count,
      writeDiagnostics: summarizeSyncWriteRows(detailRows),
    };
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
    this.logger?.debug({
      count: participants.length,
      participants: participants.slice(0, 10).map((participant) => ({
        providerId: participant.providerId,
        externalId: participant.externalId,
        sport: participant.sport,
        name: participant.name,
        active: participant.active,
      })),
    }, 'Persisting participants from ingestion');

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
            role: p.role ?? null,
            teamAffiliation: p.teamAffiliation ?? null,
            photoUrl: p.photoUrl ?? null,
            status: p.active ? 'ACTIVE' : 'INACTIVE',
          },
        });
      } else {
        // Resolve the Sport row — find or create by name
        const sport = await this.prisma.sport.upsert({
          where: { name: p.sport },
          create: {
            name: p.sport,
            participantType: 'INDIVIDUAL',
            // No schema default (#236): a new sport row must not become golf by omission.
            tournamentFormat: getDefaultTournamentFormatForSport(p.sport),
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
              role: p.role ?? null,
              teamAffiliation: p.teamAffiliation ?? null,
              photoUrl: p.photoUrl ?? null,
              status: p.active ? 'ACTIVE' : 'INACTIVE',
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

    this.logger?.info({ count }, 'Persisted participants from ingestion');
    return count;
  }

  async persistEventDetailWithDiagnostics(detail: SportEventDetail): Promise<PersistenceDiagnosticsResult<{
    eventsPersisted: number;
    participantsPersisted: number;
    sportEventParticipantsPersisted: number;
  }>> {
    this.logger?.debug({
      providerId: detail.providerId,
      externalId: detail.externalId,
      sport: detail.sport,
      name: detail.name,
      participantCount: detail.participants.length,
    }, 'Persisting event detail from ingestion');
    const eventResult = await this.persistEventsWithDiagnostics([detail]);
    const eventsPersisted = eventResult.count;
    const participantsPersisted = await this.persistParticipants(detail.participants);
    const detailRows: SyncWriteDetailRow[] = [];

    const persistedEvent = await this.prisma.sportEvent.findUnique({
      where: {
        providerId_externalId: {
          providerId: detail.providerId,
          externalId: detail.externalId,
        },
      },
    });
    if (!persistedEvent) {
      // No event is linked to this provider event, so there is no field to write
      // (persistEventsWithDiagnostics above skipped it too).
      return {
        count: 0,
        value: { eventsPersisted, participantsPersisted, sportEventParticipantsPersisted: 0 },
        writeDiagnostics: summarizeSyncWriteRows(detailRows),
      };
    }

    let sportEventParticipantsPersisted = 0;

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

      const oddsToWin = readEventScopedOddsToWin(participant, detail.externalId);
      const seedNumber = readIntegerMetadata(participant.metadata, 'seed');
      const existingEventParticipant = await this.prisma.sportEventParticipant.findUnique({
        where: {
          sportEventId_participantId: {
            sportEventId: persistedEvent.id,
            participantId: mapping.participantId,
          },
        },
      });
      // #384 — the field's own ranking wins. When the field gives none, the rank already on
      // the row stays rather than being blanked.
      const ranking = participant.ranking
        ?? existingEventParticipant?.ranking
        ?? null;
      const before = existingEventParticipant
        ? normalizeSportEventParticipantRow(existingEventParticipant)
        : undefined;
      const after = normalizeSportEventParticipantInput({
        isActive: participant.active,
        inactiveReason: participant.inactiveReason ?? null,
        ranking,
        oddsToWin,
        seedNumber,
        metadata: participant.metadata,
      });

      const persistedEventParticipant = await this.prisma.sportEventParticipant.upsert({
        where: {
          sportEventId_participantId: {
            sportEventId: persistedEvent.id,
            participantId: mapping.participantId,
          },
        },
        create: {
          sportEventId: persistedEvent.id,
          participantId: mapping.participantId,
          isActive: participant.active,
          inactiveReason: participant.inactiveReason ?? null,
          ranking,
          oddsToWin,
          seedNumber,
          metadata: toPrismaJson(participant.metadata),
        },
        update: {
          isActive: participant.active,
          inactiveReason: participant.inactiveReason ?? null,
          ranking,
          oddsToWin,
          seedNumber,
          metadata: toPrismaJson(participant.metadata),
        },
      });
      detailRows.push({
        id: `sport-event-participant:${detail.providerId}:${detail.externalId}:${participant.externalId}`,
        entityType: 'SportEventParticipant',
        disposition: resolveDisposition(before, after),
        providerId: participant.providerId,
        externalId: detail.externalId,
        participantExternalId: participant.externalId,
        internalId: persistedEventParticipant.id,
        name: participant.name,
        ...(before ? { before } : {}),
        after,
      });

      sportEventParticipantsPersisted++;
    }

    this.logger?.info({
      providerId: detail.providerId,
      externalId: detail.externalId,
      sport: detail.sport,
      eventsPersisted,
      participantsPersisted,
      sportEventParticipantsPersisted,
    }, 'Persisted event detail from ingestion');

    const value = {
      eventsPersisted,
      participantsPersisted,
      sportEventParticipantsPersisted,
    };
    return {
      count: sportEventParticipantsPersisted,
      value,
      writeDiagnostics: summarizeSyncWriteRows(detailRows),
    };
  }
}

function readEventScopedOddsToWin(
  participant: ProviderParticipant,
  eventExternalId: string,
): number | null {
  const oddsSourceEventId = participant.metadata.oddsSourceEventId;
  if (oddsSourceEventId !== eventExternalId) {
    return null;
  }

  return readNumberMetadata(participant.metadata, 'odds');
}

function resolveDisposition(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): SyncWriteDetailRow['disposition'] {
  if (!before) {
    return 'CREATED';
  }

  return stableJson(before) === stableJson(after) ? 'UNCHANGED' : 'UPDATED';
}

function normalizeSportEventRow(row: {
  externalId: string;
  providerId: string;
  sport: string;
  name: string;
  venue: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  status: SportEventStatus;
  rounds: number | null;
  participantCount: number | null;
  metadata: Prisma.JsonValue;
}): Record<string, unknown> {
  return {
    externalId: row.externalId,
    providerId: row.providerId,
    sport: row.sport,
    name: row.name,
    venue: row.venue,
    location: row.location,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    status: row.status,
    rounds: row.rounds,
    participantCount: row.participantCount,
    metadata: jsonClone(row.metadata),
  };
}

function normalizeSportEventParticipantInput(input: {
  isActive: boolean;
  inactiveReason: string | null;
  ranking: number | null;
  oddsToWin: number | null;
  seedNumber: number | null;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    isActive: input.isActive,
    inactiveReason: input.inactiveReason,
    ranking: input.ranking,
    oddsToWin: input.oddsToWin,
    seedNumber: input.seedNumber,
    metadata: jsonClone(input.metadata),
  };
}

function normalizeSportEventParticipantRow(row: {
  isActive: boolean;
  inactiveReason: string | null;
  ranking: number | null;
  oddsToWin: Prisma.Decimal | number | null;
  seedNumber: number | null;
  metadata: Prisma.JsonValue;
}): Record<string, unknown> {
  return {
    isActive: row.isActive,
    inactiveReason: row.inactiveReason,
    ranking: row.ranking,
    oddsToWin: decimalToNumber(row.oddsToWin),
    seedNumber: row.seedNumber,
    metadata: jsonClone(row.metadata),
  };
}

function decimalToNumber(value: Prisma.Decimal | number | null): number | null {
  if (value === null) {
    return null;
  }

  return typeof value === 'number' ? value : value.toNumber();
}

function jsonClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

/** The participant metadata keys that carry a number. */
type NumericParticipantMetadataKey = 'seed' | 'odds';

function readNumberMetadata(
  metadata: ProviderParticipantMetadata,
  key: NumericParticipantMetadataKey,
): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readIntegerMetadata(
  metadata: ProviderParticipantMetadata,
  key: NumericParticipantMetadataKey,
): number | null {
  const value = readNumberMetadata(metadata, key);
  return value === null ? null : Math.trunc(value);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

