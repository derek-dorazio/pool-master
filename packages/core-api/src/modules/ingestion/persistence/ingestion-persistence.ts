/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and event fields received from data providers.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  getDefaultTournamentFormatForSport,
  ParticipantStatus,
  type ParticipantType,
  type Sport,
  SportEventStatus,
  eventPlaysMatches,
} from '@poolmaster/shared/domain';
import type {
  SportEvent,
  SportEventDetail,
  ProviderParticipant,
  ProviderParticipantMetadata,
} from '../core/provider-interface';
import type { SyncWriteDetailRow, SyncWriteDiagnostics } from '../core/sync-write-diagnostics';
import { summarizeSyncWriteRows } from '../core/sync-write-diagnostics';
import type { EventFieldCache } from '../../events/event-field-cache';
import type { CdnInvalidator } from '../../../core/cdn-invalidator';
import { PublicReadPath } from '../../../core/public-cache';
import { forgettingReads, ReadMemoKey } from '../../../core/request-read-memo';

interface PersistenceDiagnosticsResult<T> {
  count: number;
  value: T;
  writeDiagnostics: SyncWriteDiagnostics;
}

export class IngestionPersistence {
  /**
   * `fieldCache`: the event fields this container read lately, an event's forgotten once its field
   * is written (#1163). `cdn`: clears the public event pages once a field is written, since a
   * loaded field is what turns an offer from NOT_YET to OPEN (#1181).
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
    private readonly fieldCache?: Pick<EventFieldCache, 'forget'>,
    private readonly cdn?: CdnInvalidator,
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
      // poolmaster-allow-query-in-loop: #1247
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

      const disposition = resolveDisposition(before, after);
      if (disposition !== 'UNCHANGED') {
        // poolmaster-allow-query-in-loop: #1247
        await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.update({
          where: { id: existingEvent.id },
          data: { participantCount },
        }));
      }
      detailRows.push({
        id: `sport-event:${event.providerId}:${event.externalId}`,
        entityType: 'SportEvent',
        disposition,
        providerId: event.providerId,
        externalId: event.externalId,
        internalId: existingEvent.id,
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
   * Upserts participants by external ID through the provider mapping table, and returns each
   * one's internal id by provider identity (#1183). The mappings are read in one query; a
   * mapped participant is updated only when a value changed, all in one transaction; an
   * unmapped one is created with its mapping, both sets in one transaction.
   */
  private async persistParticipants(participants: readonly ProviderParticipant[]): Promise<{ count: number; participantIdByKey: Map<string, string> }> {
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

    // A provider naming the same participant twice is taken at its last word, as it was when
    // each was written in turn.
    const latestByKey = new Map(participants.map((participant) => [providerKey(participant), participant]));
    const mappings = await this.findMappings([...latestByKey.values()]);
    const mappingByKey = new Map(mappings.map((mapping) => [providerKey(mapping), mapping]));
    const participantIdByKey = new Map(mappings.map((mapping) => [providerKey(mapping), mapping.participantId]));

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    const unmapped: ProviderParticipant[] = [];
    for (const [key, participant] of latestByKey) {
      const mapping = mappingByKey.get(key);
      if (!mapping) {
        unmapped.push(participant);
        continue;
      }
      const values = participantValues(participant);
      if (!participantValuesEqual(mapping.participant, values)) {
        // poolmaster-allow-query-in-loop: per-row values in one batched transaction; a set-based write needs raw SQL (held)
        updates.push(this.prisma.participant.update({ where: { id: mapping.participantId }, data: values }));
      }
    }
    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    if (unmapped.length > 0) {
      const sportBySport = new Map<Sport, { id: string; participantType: ParticipantType }>();
      for (const sport of new Set(unmapped.map((participant) => participant.sport))) {
        // poolmaster-allow-query-in-loop: once per distinct sport among new participants
        sportBySport.set(sport, await this.prisma.sport.upsert({
          where: { sport },
          create: {
            sport,
            participantType: 'INDIVIDUAL',
            // No schema default (#236): a new sport row must not become golf by omission.
            tournamentFormat: getDefaultTournamentFormatForSport(sport),
          },
          update: {},
          select: { id: true, participantType: true },
        }));
      }
      const created = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.participant.createManyAndReturn({
          data: unmapped.map((participant) => {
            const sport = sportBySport.get(participant.sport) as { id: string; participantType: ParticipantType };
            return { sportId: sport.id, participantType: sport.participantType, externalId: participant.externalId, ...participantValues(participant) };
          }),
          select: { id: true, sportId: true, externalId: true },
        });
        const idBySportAndExternalId = new Map(rows.map((row) => [`${row.sportId}:${row.externalId}`, row.id]));
        const createdMappings = unmapped.map((participant) => ({
          participantId: idBySportAndExternalId.get(`${sportBySport.get(participant.sport)?.id}:${participant.externalId}`) as string,
          providerId: participant.providerId,
          externalId: participant.externalId,
          confidence: 'EXACT' as const,
        }));
        await tx.participantProviderMapping.createMany({ data: createdMappings });
        return createdMappings;
      });
      for (const mapping of created) participantIdByKey.set(providerKey(mapping), mapping.participantId);
    }

    this.logger?.info({ count: latestByKey.size, updated: updates.length, created: unmapped.length }, 'Persisted participants from ingestion');
    return { count: latestByKey.size, participantIdByKey };
  }

  /** The provider mappings of these participants, with their participant, in one query per provider. */
  private async findMappings(participants: readonly ProviderParticipant[]) {
    const externalIdsByProvider = new Map<string, string[]>();
    for (const participant of participants) {
      externalIdsByProvider.set(participant.providerId, [...(externalIdsByProvider.get(participant.providerId) ?? []), participant.externalId]);
    }
    if (externalIdsByProvider.size === 0) return [];
    return this.prisma.participantProviderMapping.findMany({
      where: { OR: [...externalIdsByProvider].map(([providerId, externalIds]) => ({ providerId, externalId: { in: externalIds } })) },
      include: { participant: true },
    });
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
    const { count: participantsPersisted, participantIdByKey } = await this.persistParticipants(detail.participants);
    const detailRows: SyncWriteDetailRow[] = [];

    const persistedEvent = await this.prisma.sportEvent.findUnique({
      where: {
        providerId_externalId: {
          providerId: detail.providerId,
          externalId: detail.externalId,
        },
      },
      include: { eventSeries: { select: { sportLeague: { select: { participantType: true, scoringFamily: true } } } } },
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

    let sportEventParticipantsPersisted: number;
    // A released bracket's seeds are locked (#698): the upset bonus reads them as they stood at release.
    const { sportLeague } = persistedEvent.eventSeries;
    const seedsLocked = eventPlaysMatches({ sport: persistedEvent.sport, participantType: sportLeague.participantType, scoringFamily: sportLeague.scoringFamily }) && persistedEvent.status !== SportEventStatus.DRAFT;

    try {
      sportEventParticipantsPersisted = await this.persistEventField(detail, persistedEvent.id, seedsLocked, participantIdByKey, detailRows);
    } finally {
      this.fieldCache?.forget(persistedEvent.id);
      this.cdn?.invalidate([PublicReadPath.EVENT_PAGES]);
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
   * Writes the provider's field onto the event's rows, one row per mapped participant, and
   * returns how many (#1183). The rows are read in one query; an unchanged row is not
   * written, and the new and changed ones are written in one transaction.
   */
  private async persistEventField(
    detail: SportEventDetail,
    sportEventId: string,
    seedsLocked: boolean,
    participantIdByKey: ReadonlyMap<string, string>,
    detailRows: SyncWriteDetailRow[],
  ): Promise<number> {
    const mapped = new Map<string, ProviderParticipant>();
    for (const participant of detail.participants) {
      const participantId = participantIdByKey.get(providerKey(participant));
      if (participantId) mapped.set(participantId, participant);
    }
    const existingByParticipantId = new Map(
      (mapped.size === 0 ? [] : await this.prisma.sportEventParticipant.findMany({
        where: { sportEventId, participantId: { in: [...mapped.keys()] } },
      })).map((row) => [row.participantId, row]),
    );

    const plans = [...mapped].map(([participantId, participant]) => {
      const existing = existingByParticipantId.get(participantId);
      const seedNumber = seedsLocked && existing
        ? existing.seedNumber
        : readIntegerMetadata(participant.metadata, 'seed');
      // #384 — the field's own ranking wins. When the field gives none, the rank already on
      // the row stays rather than being blanked.
      const ranking = participant.ranking ?? existing?.ranking ?? null;
      const values = {
        isActive: participant.active,
        inactiveReason: participant.inactiveReason ?? null,
        ranking,
        oddsToWin: readEventScopedOddsToWin(participant, detail.externalId),
        seedNumber,
      };
      const before = existing ? normalizeSportEventParticipantRow(existing) : undefined;
      const after = normalizeSportEventParticipantInput({ ...values, metadata: participant.metadata });
      return {
        participantId,
        participant,
        existing,
        data: { ...values, metadata: toPrismaJson(participant.metadata) },
        before,
        after,
        disposition: resolveDisposition(before, after),
      };
    });

    const toCreate = plans.filter((plan) => !plan.existing);
    const toUpdate = plans.filter((plan) => plan.existing && plan.disposition !== 'UNCHANGED');
    let createdIdByParticipantId = new Map<string, string>();
    if (toCreate.length > 0 || toUpdate.length > 0) {
      const [created] = await this.prisma.$transaction([
        this.prisma.sportEventParticipant.createManyAndReturn({
          data: toCreate.map((plan) => ({ sportEventId, participantId: plan.participantId, ...plan.data })),
          select: { id: true, participantId: true },
        }),
        // poolmaster-allow-query-in-loop: per-row values in one batched transaction; a set-based write needs raw SQL (held)
        ...toUpdate.map((plan) => this.prisma.sportEventParticipant.update({
          where: { id: (plan.existing as { id: string }).id },
          data: plan.data,
        })),
      ]);
      createdIdByParticipantId = new Map(created.map((row) => [row.participantId, row.id]));
    }

    for (const plan of plans) {
      detailRows.push({
        id: `sport-event-participant:${detail.providerId}:${detail.externalId}:${plan.participant.externalId}`,
        entityType: 'SportEventParticipant',
        disposition: plan.disposition,
        providerId: plan.participant.providerId,
        externalId: detail.externalId,
        participantExternalId: plan.participant.externalId,
        internalId: plan.existing?.id ?? createdIdByParticipantId.get(plan.participantId),
        name: plan.participant.name,
        ...(plan.before ? { before: plan.before } : {}),
        after: plan.after,
      });
    }
    return plans.length;
  }
}

/** A participant's provider identity. */
function providerKey(identity: { providerId: string; externalId: string }): string {
  return `${identity.providerId}:${identity.externalId}`;
}

/** The participant columns a provider's participant sets. */
function participantValues(participant: ProviderParticipant) {
  return {
    name: participant.name,
    firstName: participant.firstName ?? null,
    lastName: participant.lastName ?? null,
    nationality: participant.nationality ?? null,
    role: participant.role ?? null,
    teamAffiliation: participant.teamAffiliation ?? null,
    photoUrl: participant.photoUrl ?? null,
    status: participant.active ? ParticipantStatus.ACTIVE : ParticipantStatus.INACTIVE,
  };
}

type ParticipantValues = ReturnType<typeof participantValues>;

function participantValuesEqual(stored: { [K in keyof ParticipantValues]: unknown }, values: ParticipantValues): boolean {
  return (Object.keys(values) as Array<keyof ParticipantValues>).every((key) => stored[key] === values[key]);
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
  sport: Sport;
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

