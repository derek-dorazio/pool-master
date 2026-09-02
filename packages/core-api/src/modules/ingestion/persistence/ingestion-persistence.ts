/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and rankings received from data providers.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { type Sport, type SportEventStatus } from '@poolmaster/shared/domain';
import type {
  ProviderRanking,
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
} from '../core/provider-interface';
import type { IngestionJobRecord } from '../core/ingestion-scheduler';
import { resolveRankingType } from '../core/ranking-types';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../core/sync-write-diagnostics';
import { summarizeSyncWriteRows } from '../core/sync-write-diagnostics';
import {
  resolveEventTiming,
  selectTimingPolicy,
} from '../../events/operational-timing';

/**
 * Narrow interface onto EventLifecycleService.applySportEventStatusTransition
 * (plans/124 §3.3) — keeps this module decoupled from the full service/actor
 * union, matching the CompletedSportEventSettlement pattern this replaces.
 */
interface SportEventLifecycleApplier {
  applySportEventStatusTransition(input: {
    sportEventId: string;
    toStatus: SportEventStatus;
    actor: { type: 'PROVIDER' };
  }): Promise<unknown>;
}

interface PersistenceDiagnosticsResult<T> {
  count: number;
  value: T;
  writeDiagnostics: SyncWriteDiagnostics;
}

export class IngestionPersistence {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly eventLifecycleService?: SportEventLifecycleApplier,
  ) {}

  /**
   * Upsert sport events by (providerId, externalId).
   * Returns the number of events persisted.
   */
  async persistEvents(events: SportEvent[]): Promise<number> {
    return (await this.persistEventsWithDiagnostics(events)).count;
  }

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
        releaseAt: event.metadata.releaseAt ?? null,
        fieldLocksAt: event.metadata.fieldLocksAt ?? null,
      })),
    }, 'Persisting sport events from ingestion');

    for (const event of events) {
      const timingPolicy = await this.resolveTimingPolicy(event.sport, event.metadata);
      const resolvedTiming = resolveEventTiming({
        sport: event.sport,
        startDate: event.startDate,
        metadata: event.metadata,
      }, timingPolicy);
      const existingEvent = await this.prisma.sportEvent.findUnique({
        where: {
          providerId_externalId: {
            providerId: event.providerId,
            externalId: event.externalId,
          },
        },
      });
      const before = existingEvent ? normalizeSportEventRow(existingEvent) : undefined;
      const after = normalizeSportEventInput(event, resolvedTiming);

      const persistedEvent = await this.prisma.sportEvent.upsert({
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
          // status intentionally omitted — takes the SCHEDULED column default here,
          // then applySportEventStatusTransition below is the one place that ever
          // writes SportEvent.status (plans/124 §3.3).
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          releaseAt: resolvedTiming.releaseAt,
          fieldLocksAt: resolvedTiming.fieldLocksAt,
          fieldLocked: event.fieldLocked,
          metadata: toPrismaJson(event.metadata),
        },
        update: {
          name: event.name,
          venue: event.venue ?? null,
          location: event.location ?? null,
          startDate: event.startDate,
          endDate: event.endDate ?? null,
          // status intentionally omitted — see the create branch above.
          rounds: event.rounds ?? null,
          participantCount: event.participantCount ?? null,
          releaseAt: resolvedTiming.releaseAt,
          fieldLocksAt: resolvedTiming.fieldLocksAt,
          fieldLocked: event.fieldLocked,
          metadata: toPrismaJson(event.metadata),
        },
      });
      detailRows.push({
        id: `sport-event:${event.providerId}:${event.externalId}`,
        entityType: 'SportEvent',
        disposition: resolveDisposition(before, after),
        providerId: event.providerId,
        externalId: event.externalId,
        internalId: persistedEvent.id,
        name: event.name,
        ...(before ? { before } : {}),
        after,
      });
      await this.eventLifecycleService?.applySportEventStatusTransition({
        sportEventId: persistedEvent.id,
        toStatus: event.status,
        actor: { type: 'PROVIDER' },
      });
      count++;
      this.logger?.debug({
        providerId: event.providerId,
        externalId: event.externalId,
        sport: event.sport,
        name: event.name,
        releaseAt: resolvedTiming.releaseAt.toISOString(),
        fieldLocksAt: resolvedTiming.fieldLocksAt.toISOString(),
        providerFieldLocked: event.fieldLocked,
      }, 'Persisted sport event from ingestion');
    }

    this.logger?.info({ count }, 'Persisted sport events from ingestion');
    return {
      count,
      value: count,
      writeDiagnostics: summarizeSyncWriteRows(detailRows),
    };
  }


  async persistIngestionJob(job: IngestionJobRecord): Promise<void> {
    this.logger?.debug({
      jobType: job.jobType,
      providerId: job.providerId,
      sport: job.sport,
      eventExternalId: job.eventExternalId ?? null,
      status: job.status,
      recordsProcessed: job.recordsProcessed,
      errors: job.errors,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
    }, 'Persisting ingestion job completion');

    await this.prisma.ingestionJob.create({
      data: {
        jobType: job.jobType,
        providerId: job.providerId,
        sport: job.sport,
        eventExternalId: job.eventExternalId ?? null,
        status: job.status,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
        recordsProcessed: job.recordsProcessed,
        errors: job.errors,
        errorLog: toPrismaJson(job.errorLog),
      },
    });

    this.logger?.info({
      jobType: job.jobType,
      providerId: job.providerId,
      sport: job.sport,
      eventExternalId: job.eventExternalId ?? null,
      status: job.status,
      recordsProcessed: job.recordsProcessed,
      errors: job.errors,
    }, 'Persisted ingestion job completion');
  }

  private async resolveTimingPolicy(
    sport: Sport,
    metadata: Record<string, unknown>,
  ) {
    const policies = await this.prisma.contestTimingPolicy.findMany({
      where: {
        sport,
        active: true,
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    return selectTimingPolicy(
      policies,
      metadata,
    );
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
            position: p.position ?? null,
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
  }> {
    return (await this.persistEventDetailWithDiagnostics(detail)).value;
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
      throw new Error(
        `Persisted sport event not found for ${detail.providerId}:${detail.externalId}`,
      );
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

      const worldRanking = await this.findLatestRankingForEventParticipant({
        providerId: participant.providerId,
        participantId: mapping.participantId,
        sport: detail.sport,
      });
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
      const before = existingEventParticipant
        ? normalizeSportEventParticipantRow(existingEventParticipant)
        : undefined;
      const after = normalizeSportEventParticipantInput({
        isActive: participant.active,
        inactiveReason: participant.inactiveReason ?? null,
        worldRanking,
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
          worldRanking,
          oddsToWin,
          seedNumber,
          metadata: toPrismaJson(participant.metadata),
        },
        update: {
          isActive: participant.active,
          inactiveReason: participant.inactiveReason ?? null,
          worldRanking,
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

  /**
   * Persist global participant ranking snapshots by provider-scoped mapping.
   *
   * Rankings are not event-scoped source facts. They are provider-scoped
   * snapshots keyed by ranking type + asOf; event participant hydration copies
   * the latest applicable snapshot onto SportEventParticipant.worldRanking.
   */
  async persistRankings(rankings: ProviderRanking[]): Promise<number> {
    return (await this.persistRankingsWithDiagnostics(rankings)).count;
  }

  async persistRankingsWithDiagnostics(
    rankings: ProviderRanking[],
  ): Promise<PersistenceDiagnosticsResult<number>> {
    let count = 0;
    const detailRows: SyncWriteDetailRow[] = [];
    this.logger?.debug({
      count: rankings.length,
      rankings: rankings.slice(0, 10).map((ranking) => ({
        providerId: ranking.providerId,
        participantExternalId: ranking.participantExternalId,
        rankingType: ranking.rankingType,
        rank: ranking.rank,
        asOfDate: ranking.asOfDate.toISOString(),
      })),
    }, 'Persisting participant ranking snapshots from ingestion');

    for (const ranking of rankings) {
      const mapping = await this.prisma.participantProviderMapping.findUnique({
        where: {
          providerId_externalId: {
            providerId: ranking.providerId,
            externalId: ranking.participantExternalId,
          },
        },
      });

      if (!mapping) {
        this.logger?.warn({
          providerId: ranking.providerId,
          participantExternalId: ranking.participantExternalId,
          rankingType: ranking.rankingType,
        }, 'Skipped participant ranking because provider mapping was not found');
        continue;
      }
      const existingRanking = await this.prisma.participantRankingSnapshot.findUnique({
        where: {
          providerId_participantId_rankingType_asOfDate: {
            providerId: ranking.providerId,
            participantId: mapping.participantId,
            rankingType: ranking.rankingType,
            asOfDate: ranking.asOfDate,
          },
        },
      });
      const before = existingRanking ? normalizeRankingSnapshotRow(existingRanking) : undefined;
      const after = normalizeRankingSnapshotInput(ranking, mapping.participantId);

      const persistedRanking = await this.prisma.participantRankingSnapshot.upsert({
        where: {
          providerId_participantId_rankingType_asOfDate: {
            providerId: ranking.providerId,
            participantId: mapping.participantId,
            rankingType: ranking.rankingType,
            asOfDate: ranking.asOfDate,
          },
        },
        create: {
          providerId: ranking.providerId,
          participantId: mapping.participantId,
          rankingType: ranking.rankingType,
          rank: ranking.rank,
          points: ranking.points ?? null,
          asOfDate: ranking.asOfDate,
        },
        update: {
          rank: ranking.rank,
          points: ranking.points ?? null,
        },
      });
      detailRows.push({
        id: `participant-ranking:${ranking.providerId}:${mapping.participantId}:${ranking.rankingType}:${ranking.asOfDate.toISOString()}`,
        entityType: 'ParticipantRankingSnapshot',
        disposition: resolveDisposition(before, after),
        providerId: ranking.providerId,
        participantExternalId: ranking.participantExternalId,
        internalId: persistedRanking.id,
        name: ranking.participantExternalId,
        ...(before ? { before } : {}),
        after,
      });
      count++;
    }

    this.logger?.info({ count }, 'Persisted participant ranking snapshots from ingestion');
    return {
      count,
      value: count,
      writeDiagnostics: summarizeSyncWriteRows(detailRows),
    };
  }

  private async findLatestRankingForEventParticipant(input: {
    providerId: string;
    participantId: string;
    sport: Sport;
  }): Promise<number | null> {
    const snapshot = await this.prisma.participantRankingSnapshot.findFirst({
      where: {
        providerId: input.providerId,
        participantId: input.participantId,
        rankingType: resolveRankingType(input.sport),
      },
      orderBy: { asOfDate: 'desc' },
    });

    return snapshot?.rank ?? null;
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

function normalizeSportEventInput(
  event: SportEvent,
  timing: { releaseAt: Date; fieldLocksAt: Date },
): Record<string, unknown> {
  return {
    externalId: event.externalId,
    providerId: event.providerId,
    sport: event.sport,
    name: event.name,
    venue: event.venue ?? null,
    location: event.location ?? null,
    startDate: event.startDate.toISOString(),
    endDate: event.endDate?.toISOString() ?? null,
    status: event.status,
    rounds: event.rounds ?? null,
    participantCount: event.participantCount ?? null,
    releaseAt: timing.releaseAt.toISOString(),
    fieldLocksAt: timing.fieldLocksAt.toISOString(),
    fieldLocked: event.fieldLocked,
    metadata: jsonClone(event.metadata),
  };
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
  status: string;
  rounds: number | null;
  participantCount: number | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
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
    releaseAt: row.releaseAt.toISOString(),
    fieldLocksAt: row.fieldLocksAt.toISOString(),
    fieldLocked: row.fieldLocked,
    metadata: jsonClone(row.metadata),
  };
}

function normalizeSportEventParticipantInput(input: {
  isActive: boolean;
  inactiveReason: string | null;
  worldRanking: number | null;
  oddsToWin: number | null;
  seedNumber: number | null;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    isActive: input.isActive,
    inactiveReason: input.inactiveReason,
    worldRanking: input.worldRanking,
    oddsToWin: input.oddsToWin,
    seedNumber: input.seedNumber,
    metadata: jsonClone(input.metadata),
  };
}

function normalizeSportEventParticipantRow(row: {
  isActive: boolean;
  inactiveReason: string | null;
  worldRanking: number | null;
  oddsToWin: Prisma.Decimal | number | null;
  seedNumber: number | null;
  metadata: Prisma.JsonValue;
}): Record<string, unknown> {
  return {
    isActive: row.isActive,
    inactiveReason: row.inactiveReason,
    worldRanking: row.worldRanking,
    oddsToWin: decimalToNumber(row.oddsToWin),
    seedNumber: row.seedNumber,
    metadata: jsonClone(row.metadata),
  };
}

function normalizeRankingSnapshotInput(
  ranking: ProviderRanking,
  participantId: string,
): Record<string, unknown> {
  return {
    providerId: ranking.providerId,
    participantId,
    rankingType: ranking.rankingType,
    rank: ranking.rank,
    points: ranking.points ?? null,
    asOfDate: ranking.asOfDate.toISOString(),
  };
}

function normalizeRankingSnapshotRow(row: {
  providerId: string;
  participantId: string;
  rankingType: string;
  rank: number;
  points: Prisma.Decimal | number | null;
  asOfDate: Date;
}): Record<string, unknown> {
  return {
    providerId: row.providerId,
    participantId: row.participantId,
    rankingType: row.rankingType,
    rank: row.rank,
    points: decimalToNumber(row.points),
    asOfDate: row.asOfDate.toISOString(),
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

function readNumberMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readIntegerMetadata(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = readNumberMetadata(metadata, key);
  return value === null ? null : Math.trunc(value);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

