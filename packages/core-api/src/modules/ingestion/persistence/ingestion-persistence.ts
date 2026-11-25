/**
 * IngestionPersistence — persists ingested data to the database via Prisma.
 *
 * Called by ingestion callbacks to upsert sport events, participants,
 * and event fields received from data providers.
 */

import { randomUUID } from 'node:crypto';
import { type Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  ParticipantStatus,
  type ProviderCode,
  type ParticipantType,
  type Sport,
  SportEventStatus,
  eventPlaysMatches,
  providerSourceIdOf,
  requireProviderCodeOfSourceId,
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
import type { JobsForWrite } from '../../background-jobs/background-job-queue';
import { backgroundJobsInsert, insertBackgroundJobs } from '../../../adapters/prisma-background-job-repository';
import { DomainEventType, type DomainEvents } from '../../domain-events';
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
   * loaded field is what turns an offer from NOT_YET to OPEN (#1181). `domainEvents`: what follows
   * a field sync, written with the field (#1946): the event's games and then its tiers and prices
   * (#1952), and, when a row changed, the event's contests' stored leaderboards computed again
   * (#1435, #1466).
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly domainEvents: Pick<DomainEvents, 'collect'>,
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

    // #1247: every linked event in one read, and the changed ones in one transaction. A provider
    // naming the same event twice is taken at its last word, as persistParticipants does.
    const latestByKey = new Map(events.map((event) => [providerKey(event), event]));
    const linkedEvents = await this.findLinkedEvents([...latestByKey.values()]);
    const linkedByKey = new Map(linkedEvents.map((row) => [providerKey(row), row]));
    const updates: Array<{ id: string; participantCount: number | null }> = [];

    for (const event of latestByKey.values()) {
      const existingEvent = linkedByKey.get(providerKey(event));
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
        updates.push({ id: existingEvent.id, participantCount });
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

    if (updates.length > 0) {
      await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction(updates.map((update) =>
        // poolmaster-allow-query-in-loop: the changed events of one provider feed (per-row values, one transaction)
        this.prisma.sportEvent.update({ where: { id: update.id }, data: { participantCount: update.participantCount } }))));
    }

    this.logger?.info({ count }, 'Persisted sport events from ingestion');
    return {
      count,
      value: count,
      writeDiagnostics: summarizeSyncWriteRows(detailRows),
    };
  }

  /**
   * Upserts the event's participants by external ID through the provider mapping table, within
   * the event's sport league, and returns each one's internal id by provider identity (#1183,
   * #1853). A participant belongs to one sport league, so the same feed player in two leagues (an
   * LCS and a World Series) is two participants, each mapped in its own league. The mappings are
   * read in one query; a mapped participant is updated only when a value changed, all in one
   * transaction. A feed id the league has no participant mapped to is a new participant of the
   * league: it is created with its mapping, and never linked to a participant by its name
   * (#1850), all in one transaction. A test data file's participant the sync should share carries
   * the provider's feed id, mapped as the file loads.
   */
  private async persistParticipants(
    participants: readonly ProviderParticipant[],
    league: LeagueOfEvent,
  ): Promise<{ count: number; participantIdByKey: Map<string, string> }> {
    this.logger?.debug({
      count: participants.length,
      sportLeagueId: league.id,
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
    const mappings = await this.findMappings([...latestByKey.values()], league.id);
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
        // poolmaster-allow-query-in-loop: the changed participants of one provider feed (per-row values, one transaction)
        updates.push(this.prisma.participant.update({ where: { id: mapping.participantId }, data: values }));
      }
    }
    const changedCount = updates.length;
    // Every mapped participant the feed listed was seen now (#1865), in one statement for the
    // whole field, written with the changed values.
    const seenAt = new Date();
    if (mappings.length > 0) {
      updates.push(this.prisma.participantProviderMapping.updateMany({
        where: { id: { in: mappings.map((mapping) => mapping.id) } },
        data: { lastSeenAt: seenAt },
      }));
    }
    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    if (unmapped.length > 0) {
      const created = await this.prisma.$transaction(async (tx) => {
        // Each new participant's mapping is keyed to its Provider row (#2040), read once here.
        const providerIds = new Map((await tx.provider.findMany({
          where: { code: { in: [...new Set(unmapped.map((participant) => requireProviderCodeOfSourceId(participant.providerId)))] } },
          select: { id: true, code: true },
        })).map((provider) => [provider.code, provider.id]));
        // Each participant's id is chosen here, so its mapping names it without leaning on the
        // order the insert returns rows in (rules/domain-model-conventions-rules.md §17).
        const withIds = unmapped.map((participant) => ({ participant, participantId: randomUUID() }));
        await tx.participant.createMany({
          data: withIds.map(({ participant, participantId }) => ({
            id: participantId,
            sportLeagueId: league.id,
            participantType: league.participantType,
            ...participantValues(participant),
          })),
        });
        await tx.participantProviderMapping.createMany({
          data: withIds.map(({ participant, participantId }) => ({
            participantId,
            sportLeagueId: league.id,
            participantType: league.participantType,
            providerId: requireProviderId(providerIds, participant.providerId),
            externalId: participant.externalId,
            lastSeenAt: seenAt,
          })),
        });
        return withIds.map(({ participant, participantId }) => ({
          providerId: participant.providerId,
          externalId: participant.externalId,
          participantId,
        }));
      });
      for (const mapping of created) participantIdByKey.set(providerKey(mapping), mapping.participantId);
    }

    this.logger?.info({ count: latestByKey.size, sportLeagueId: league.id, updated: changedCount, created: unmapped.length }, 'Persisted participants from ingestion');
    return { count: latestByKey.size, participantIdByKey };
  }

  /** The sport events linked to these provider events, in one query grouped by provider. */
  private async findLinkedEvents(events: readonly SportEvent[]) {
    const externalIdsByProvider = new Map<string, string[]>();
    for (const event of events) {
      externalIdsByProvider.set(event.providerId, [...(externalIdsByProvider.get(event.providerId) ?? []), event.externalId]);
    }
    if (externalIdsByProvider.size === 0) return [];
    return this.prisma.sportEvent.findMany({
      where: { OR: [...externalIdsByProvider].map(([providerId, externalIds]) => ({ providerId, externalId: { in: externalIds } })) },
    });
  }

  /**
   * The sport league's provider mappings of these participants, with their participant, in one
   * query. Each mapping is keyed to its Provider row (#2040), read here by the code of the adapter
   * that named the participant, and comes back under that adapter's id, as the feed names it.
   */
  private async findMappings(participants: readonly ProviderParticipant[], sportLeagueId: string) {
    const externalIdsByCode = new Map<ProviderCode, string[]>();
    for (const participant of participants) {
      const code = requireProviderCodeOfSourceId(participant.providerId);
      externalIdsByCode.set(code, [...(externalIdsByCode.get(code) ?? []), participant.externalId]);
    }
    if (externalIdsByCode.size === 0) return [];
    const rows = await this.prisma.participantProviderMapping.findMany({
      where: { sportLeagueId, OR: [...externalIdsByCode].map(([code, externalIds]) => ({ provider: { code }, externalId: { in: externalIds } })) },
      include: { participant: true, provider: { select: { code: true } } },
    });
    return rows.map(({ provider, ...mapping }) => ({ ...mapping, providerId: providerSourceIdOf(provider.code) }));
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
    const persistedEvent = await this.prisma.sportEvent.findUnique({
      where: {
        providerId_externalId: {
          providerId: detail.providerId,
          externalId: detail.externalId,
        },
      },
      include: {
        eventSeries: {
          select: { sportLeague: { select: { id: true, participantType: true, scoringFamily: true, sport: { select: { sport: true } } } } },
        },
      },
    });
    const detailRows: SyncWriteDetailRow[] = [];

    if (!persistedEvent) {
      // No event is linked to this provider event, so there is no field to write and no sport
      // league for its participants to belong to (persistEventsWithDiagnostics above skipped it
      // too).
      return {
        count: 0,
        value: { eventsPersisted, participantsPersisted: 0, sportEventParticipantsPersisted: 0 },
        writeDiagnostics: summarizeSyncWriteRows(detailRows),
      };
    }

    const { sportLeague } = persistedEvent.eventSeries;
    const { count: participantsPersisted, participantIdByKey } = await this.persistParticipants(detail.participants, {
      id: sportLeague.id,
      participantType: sportLeague.participantType,
    });
    let sportEventParticipantsPersisted: number;
    const seedsLocked = seedsLockedOn(persistedEvent);
    // What follows the field (#1952): the provider's games, then the tiers and prices, in a job
    // written with the field, so a task that stops after the write still has them run.
    const followUps = await this.domainEvents.collect({
      type: DomainEventType.SPORT_EVENT_FIELD_SYNCED,
      sportEvent: { id: persistedEvent.id, status: persistedEvent.status },
      providerId: detail.providerId,
      externalId: detail.externalId,
      ...(detail.games !== undefined && { games: detail.games }),
      ...(detail.bracket !== undefined && { bracket: detail.bracket }),
    });

    try {
      sportEventParticipantsPersisted = await this.persistEventField(detail, persistedEvent.id, seedsLocked, participantIdByKey, detailRows, followUps);
    } finally {
      this.fieldCache?.forget(persistedEvent.id);
      this.cdn?.invalidate([PublicReadPath.EVENT_PAGES]);
    }
    followUps.queued();

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
   * written, and the new and changed ones are written in one transaction, with the field sync's
   * follow-up jobs. A field with no row to write still writes those jobs, on their own: the
   * provider's games may have changed when its field did not.
   */
  private async persistEventField(
    detail: FieldFeed,
    sportEventId: string,
    seedsLocked: boolean,
    participantIdByKey: ReadonlyMap<string, string>,
    detailRows: SyncWriteDetailRow[],
    followUps: JobsForWrite,
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
      // The field changed, so what follows it (the boards' rebuild, #1466) is written with it.
      const rebuild = await this.domainEvents.collect({ type: DomainEventType.SPORT_EVENT_RESULTS_CHANGED, sportEventId });
      const [created] = await this.prisma.$transaction([
        this.prisma.sportEventParticipant.createManyAndReturn({
          // A play-in place is marked as one when its row is made; a later load leaves the mark to the bracket's own fill (#1571).
          data: toCreate.map((plan) => ({ sportEventId, participantId: plan.participantId, ...plan.data, isPlayInPlace: plan.participant.metadata.playInPlace === true })),
          select: { id: true, participantId: true },
        }),
        // poolmaster-allow-query-in-loop: the changed rows of one event's field (per-row values, one transaction)
        ...toUpdate.map((plan) => this.prisma.sportEventParticipant.update({
          where: { id: (plan.existing as { id: string }).id },
          data: plan.data,
        })),
        ...(rebuild.jobs.length > 0 || followUps.jobs.length > 0 ? [backgroundJobsInsert(this.prisma, [...rebuild.jobs, ...followUps.jobs])] : []),
      ]);
      rebuild.queued();
      createdIdByParticipantId = new Map(created.map((row) => [row.participantId, row.id]));
    } else {
      await insertBackgroundJobs(this.prisma, followUps.jobs);
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

/** What a field write reads of a provider's event detail: whose field it is, and its participants. */
type FieldFeed = Pick<SportEventDetail, 'providerId' | 'externalId' | 'participants'>;

/** Whether an event's seeds are locked: a released bracket's are (#698), since the upset bonus reads them as they stood at release. */
function seedsLockedOn(event: {
  status: SportEventStatus;
  eventSeries: { sportLeague: { participantType: ParticipantType; scoringFamily: Parameters<typeof eventPlaysMatches>[0]['scoringFamily']; sport: { sport: Sport } } };
}): boolean {
  const { sportLeague } = event.eventSeries;
  return eventPlaysMatches({ sport: sportLeague.sport.sport, participantType: sportLeague.participantType, scoringFamily: sportLeague.scoringFamily }) && event.status !== SportEventStatus.DRAFT;
}

/** The sport league an event's participants belong to (#1853), and the kind of participant it holds. */
interface LeagueOfEvent {
  id: string;
  participantType: ParticipantType;
}

/** The Provider row id of the adapter whose feed carries `sourceId`, from the rows read by code. */
function requireProviderId(idsByCode: ReadonlyMap<ProviderCode, string>, sourceId: string): string {
  const id = idsByCode.get(requireProviderCodeOfSourceId(sourceId));
  if (id === undefined) throw new Error(`Provider ${sourceId} has no Provider row, so its participants cannot be mapped.`);
  return id;
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

