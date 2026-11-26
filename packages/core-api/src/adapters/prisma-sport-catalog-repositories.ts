/**
 * Prisma adapters for the cross-sport catalog and event-core ports (#235, #236):
 * Sport, SportLeague, SportEvent,
 * SportEventRound, SportEventParticipant, SportEventTier,
 * and SportEventParticipantValuation.
 *
 * Sport extension rows (golf rounds and standings, race results, matches) have
 * their own adapters. The one exception is the field read (#1163): a field row comes with
 * every extension at once, mapped by those adapters' own mappers.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  PriceAssignment,
  SportEventCreate,
  SportEventFilters,
  SportEventParticipantCreate,
  SportEventParticipantFieldUpdate,
  SportEventParticipantPatch,
  SportEventParticipantRepository,
  SportEventParticipantValuationRepository,
  SportEventParticipantView,
  SportEventLink,
  SportEventProviderSummary,
  SportEventAutoReleaseCandidate,
  SportEventReleaseFacts,
  ProviderNotifiedEvent,
  ProviderNotifiedEventQuery,
  ProviderNotificationReceipt,
  AutoLifecycleCandidate,
  AutoLifecycleStatus,
  SportEventRepository,
  SportEventRoundRepository,
  SportEventRoundCreate,
  SportEventRoundSchedule,
  SportEventTierCreate,
  SportEventTierDefinition,
  SportEventTierRepository,
  SportEventStatusTransition,
  SportEventUpdate,
  SportLeagueFilters,
  SportLeagueRepository,
  SportLeagueUpdate,
  SportLeagueUses,
  SportRepository,
  TierAssignment,
} from '@poolmaster/shared/db';
import type {
  AutoReleaseCheck,
  BackgroundJobRequest,
  EventPricingConfig,
  EventTierConfig,
  MatchStatus,
  ParticipantRoundStatus,
  RoundResultFacts,
  RoundResultGroup,
  Sport,
  SportConfig,
  SportEvent,
  SportEventParticipant,
  SportEventParticipantValuation,
  SportEventRound,
  SportEventTier,
  SportLeague,
  SportLeagueProviderMapping,
  SportLeagueSeasonSlot,
} from '@poolmaster/shared/domain';
import { compareCoveredSlots, compareMatchPlaces, compareSeasonSlots, EventPricingConfigSchema, EventTierConfigSchema, ParticipantStatus, providerCodeOfSourceId, providerSourceIdOf, requireProviderCodeOfSourceId, SportEventParticipantStatus, SportEventStatus, ValuationSource } from '@poolmaster/shared/domain';
import { forgettingReads, memoizedRead, memoizedReadMany, ReadMemoKey } from '../core/request-read-memo';
import { backgroundJobsInsert, insertBackgroundJobs } from './prisma-background-job-repository';
import { toGolfRound, toGolfStanding } from './prisma-golf-repositories';
import { MATCH_INCLUDE, toSportEventRoundMatch } from './prisma-match-repositories';
import { mapToParticipant } from './prisma-participant-repository';
import { toRaceResult } from './prisma-race-repositories';
import { SYNC_PROVIDER_SELECT, syncProviderIdOf, syncProviderNameOf } from './prisma-sync-provider';
import { SPORT_EVENT_SPORT_SELECT, SPORT_LEAGUE_SPORT_SELECT, sportEventSportWhere, sportOfEvent, sportUrlSegmentOfEvent } from './sport-of';
import { COVERS_TEST_SLOT, ROUND_EVENT_SLOT_SELECT, SEASON_SLOT_SELECT, toRoundSlot, toSeasonSlot } from './season-slot-select';
import { SLOT_PLACE_SELECT, slotPlaceOf } from './slot-place-select';

/** The statuses the lifecycle scheduler moves an event on from. */
const AUTO_LIFECYCLE_STATUSES: readonly AutoLifecycleStatus[] = [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS, SportEventStatus.POSTPONED];

function isAutoLifecycleCandidate(event: SportEvent): event is AutoLifecycleCandidate {
  return (AUTO_LIFECYCLE_STATUSES as readonly SportEventStatus[]).includes(event.status);
}

type Db = PrismaClient;

/** An active sport league whose events a provider's sync creates (ADR 0011): it has a selected provider mapping (#1997). */
const EVENT_SYNCED_LEAGUE = { isActive: true, selectedProviderMappingId: { not: null } } satisfies Prisma.SportLeagueWhereInput;

/** A sport league's selected provider mapping, with the names the screens show (#1997). */
export const SELECTED_PROVIDER_MAPPING_INCLUDE = {
  selectedProviderMapping: {
    select: {
      id: true,
      providerLeague: { select: { id: true, code: true, name: true, provider: { select: { code: true, name: true } } } },
    },
  },
} satisfies Prisma.SportLeagueInclude;

type SportLeagueRow = Prisma.SportLeagueGetPayload<{ include: typeof SELECTED_PROVIDER_MAPPING_INCLUDE }>;

/** A sport league's selected provider mapping as the domain reads it; null when the league is not synced. */
export function toSelectedProviderMapping(mapping: SportLeagueRow['selectedProviderMapping']): SportLeagueProviderMapping | null {
  if (mapping === null) return null;
  return {
    id: mapping.id,
    providerLeagueId: mapping.providerLeague.id,
    providerLeagueCode: mapping.providerLeague.code,
    providerLeagueName: mapping.providerLeague.name,
    providerCode: mapping.providerLeague.provider.code,
    providerName: mapping.providerLeague.provider.name,
    providerId: providerSourceIdOf(mapping.providerLeague.provider.code),
  };
}

export class PrismaSportRepository implements SportRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { id } });
    return row ? toSport(row) : null;
  }

  async findBySport(sport: Sport): Promise<SportConfig | null> {
    const row = await this.prisma.sport.findUnique({ where: { sport } });
    return row ? toSport(row) : null;
  }

  async findAll(): Promise<SportConfig[]> {
    // In the sports' own display order (#2042).
    const rows = await this.prisma.sport.findMany({ orderBy: { displayOrder: 'asc' } });
    return rows.map(toSport);
  }
}

export class PrismaSportLeagueRepository implements SportLeagueRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportLeague | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.sportLeague}${id}`, async () => {
      const row = await this.prisma.sportLeague.findUnique({ where: { id }, include: SELECTED_PROVIDER_MAPPING_INCLUDE });
      return row ? toSportLeague(row) : null;
    });
  }

  async findByIds(ids: readonly string[]): Promise<SportLeague[]> {
    if (ids.length === 0) {
      return [];
    }
    return memoizedReadMany(this.prisma, ReadMemoKey.sportLeague, ids, async (missing) => {
      const rows = await this.prisma.sportLeague.findMany({ where: { id: { in: [...missing] } }, include: SELECTED_PROVIDER_MAPPING_INCLUDE });
      return rows.map(toSportLeague);
    });
  }

  async findAll(filters: SportLeagueFilters): Promise<SportLeague[]> {
    const rows = await this.prisma.sportLeague.findMany({
      where: {
        ...(filters.sportId !== undefined && { sportId: filters.sportId }),
        ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      },
      include: SELECTED_PROVIDER_MAPPING_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toSportLeague);
  }

  async findEventSynced(): Promise<SportLeague[]> {
    const rows = await this.prisma.sportLeague.findMany({
      where: EVENT_SYNCED_LEAGUE,
      include: SELECTED_PROVIDER_MAPPING_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toSportLeague);
  }

  async update(id: string, updates: SportLeagueUpdate): Promise<SportLeague> {
    const { syncProviderLeagueId } = updates;
    const data = {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.autoReleaseDaysBeforeStart !== undefined && { autoReleaseDaysBeforeStart: updates.autoReleaseDaysBeforeStart }),
        ...(updates.platformTierProfileId !== undefined && { platformTierProfileId: updates.platformTierProfileId }),
        ...(updates.platformPricingProfileId !== undefined && { platformPricingProfileId: updates.platformPricingProfileId }),
    } satisfies Prisma.SportLeagueUncheckedUpdateInput;
    // A provider league to sync from is mapped when it is not yet, then selected, in one
    // transaction (#1997); null stops the sync and keeps the mapping.
    const write = () => (syncProviderLeagueId === undefined
      ? this.prisma.sportLeague.update({ where: { id }, data, include: SELECTED_PROVIDER_MAPPING_INCLUDE })
      : this.prisma.$transaction(async (tx) => {
        const mapping = syncProviderLeagueId === null
          ? null
          : await tx.sportLeagueProviderMapping.upsert({
            where: { sportLeagueId_providerLeagueId: { sportLeagueId: id, providerLeagueId: syncProviderLeagueId } },
            create: { sportLeagueId: id, providerLeagueId: syncProviderLeagueId },
            update: {},
            select: { id: true },
          });
        return tx.sportLeague.update({
          where: { id },
          data: { ...data, selectedProviderMappingId: mapping?.id ?? null },
          include: SELECTED_PROVIDER_MAPPING_INCLUDE,
        });
      }));
    // A sport event's read carries its sport league's settings, so those are forgotten too.
    return toSportLeague(await forgettingReads([ReadMemoKey.sportEvent, ReadMemoKey.sportLeague], write));
  }

  async deleteUnlessUsed(id: string): Promise<SportLeagueUses | null> {
    return forgettingReads(ReadMemoKey.sportLeague, () => this.prisma.$transaction(async (tx) => {
      // FOR UPDATE conflicts with the FOR KEY SHARE a child insert takes on the row it references:
      // a cup, setup, offer or event (each on the sport league) made meanwhile
      // either committed first and is counted below, or waits and then fails once the rows are gone.
      // A cup would otherwise go silently, by its cascade.
      // poolmaster-allow-raw-sql: a row lock (SELECT … FOR UPDATE): Prisma has no row locks
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "sport_leagues" WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) return null;
      // Each use is counted where its sport league is: a relation `_count` would group every row of
      // the child table and join the groups back, reading the whole sport event catalog.
      const uses: SportLeagueUses = {
        sportEventCount: await tx.sportEvent.count({ where: { sportLeagueId: id } }),
        contestTemplateCount: await tx.contestConfigTemplate.count({ where: { sportLeagueId: id } }),
        eventPageOfferCount: await tx.eventPageOffer.count({ where: { sportLeagueId: id } }),
        cupCount: await tx.cup.count({ where: { sportLeagueId: id } }),
        participantCount: await tx.participant.count({ where: { sportLeagueId: id } }),
      };
      if (Object.values(uses).some((count) => count > 0)) return uses;
      // A Season's phases restrict their phase definition's delete, its competitions their
      // competition's and its slots their slot definition's, so the league's cascade cannot take
      // them: they go first, slots before competitions before phases.
      await tx.sportLeagueSeasonCompetitionSlot.deleteMany({ where: { sportLeagueId: id } });
      await tx.sportLeagueSeasonCompetition.deleteMany({ where: { sportLeagueId: id } });
      await tx.sportLeagueSeasonPhase.deleteMany({ where: { sportLeagueId: id } });
      // A muted list is checked when set, not a foreign key, and a league saves its whole list
      // back: an id left in it would make that save fail. Prisma cannot remove an array element.
      // poolmaster-allow-raw-sql: a set-based array update (array_remove across rows): Prisma can't remove one element from an array column in one statement
      await tx.$executeRaw`UPDATE "leagues" SET muted_sport_league_ids = array_remove(muted_sport_league_ids, ${id}::uuid) WHERE ${id}::uuid = ANY(muted_sport_league_ids)`;
      await tx.sportLeague.delete({ where: { id } });
      return uses;
    }));
  }
}

export class PrismaSportEventRepository implements SportEventRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportEvent | null> {
    return memoizedRead(this.prisma, `${ReadMemoKey.sportEvent}${id}`, async () => {
      const row = await this.prisma.sportEvent.findUnique({ where: { id }, include: SPORT_EVENT_INCLUDE });
      return row ? toSportEvent(row) : null;
    });
  }

  async findByIds(ids: readonly string[]): Promise<SportEvent[]> {
    if (!ids.length) {
      return [];
    }
    return memoizedReadMany(this.prisma, ReadMemoKey.sportEvent, ids, async (missing) => {
      const rows = await this.prisma.sportEvent.findMany({ where: { id: { in: [...missing] } }, include: SPORT_EVENT_INCLUDE });
      return rows.map(toSportEvent);
    });
  }

  async findLinks(ids: readonly string[]): Promise<SportEventLink[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.sportEvent.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        name: true,
        providerMappings: { select: { sportLeagueProviderMappingId: true } },
        sportLeagueSeason: { select: { sportLeagueId: true, sportLeague: { select: { selectedProviderMappingId: true, ...SYNC_PROVIDER_SELECT } } } },
      },
    });
    return rows.map((row) => {
      const league = row.sportLeagueSeason.sportLeague;
      const synced = row.providerMappings.some((mapping) => mapping.sportLeagueProviderMappingId === league.selectedProviderMappingId);
      return { id: row.id, name: row.name, sportLeagueId: row.sportLeagueSeason.sportLeagueId, providerId: synced ? syncProviderIdOf(league) : null };
    });
  }

  async findByProviderRef(providerId: string, externalId: string): Promise<SportEvent | null> {
    // An adapter id no Provider carries has no events.
    const code = providerCodeOfSourceId(providerId);
    if (code === undefined) return null;
    const row = await this.prisma.sportEvent.findFirst({
      where: { providerMappings: { some: { provider: { code }, externalId } } },
      include: SPORT_EVENT_INCLUDE,
    });
    return row ? toSportEvent(row) : null;
  }

  async findByProviderRefs(providerId: string, externalIds: readonly string[]): Promise<SportEvent[]> {
    const code = providerCodeOfSourceId(providerId);
    if (externalIds.length === 0 || code === undefined) return [];
    const rows = await this.prisma.sportEvent.findMany({
      where: { providerMappings: { some: { provider: { code }, externalId: { in: [...externalIds] } } } },
      include: SPORT_EVENT_INCLUDE,
    });
    return rows.map(toSportEvent);
  }

  async findFieldFeedIds(providerId: string, sportLeagueId: string, sportEventIds: readonly string[]): Promise<Map<string, ReadonlySet<string>>> {
    const code = providerCodeOfSourceId(providerId);
    const fields = new Map<string, Set<string>>();
    if (sportEventIds.length === 0 || code === undefined) return fields;
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] }, isActive: true },
      select: { sportEventId: true, participantId: true },
    });
    if (rows.length === 0) return fields;
    const mappings = await this.prisma.participantProviderMapping.findMany({
      where: { provider: { code }, sportLeagueId, participantId: { in: [...new Set(rows.map((row) => row.participantId))] } },
      select: { participantId: true, externalId: true },
    });
    const feedIdsOf = new Map<string, string[]>();
    for (const mapping of mappings) feedIdsOf.set(mapping.participantId, [...(feedIdsOf.get(mapping.participantId) ?? []), mapping.externalId]);
    for (const row of rows) {
      const field = fields.get(row.sportEventId) ?? new Set<string>();
      for (const feedId of feedIdsOf.get(row.participantId) ?? []) field.add(feedId);
      fields.set(row.sportEventId, field);
    }
    return fields;
  }

  async findAll(filters: SportEventFilters): Promise<SportEvent[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...(filters.statuses !== undefined && { status: { in: [...filters.statuses] } }),
        ...((filters.sportLeagueId !== undefined || filters.activeSportLeaguesOnly || filters.sport !== undefined) && {
          sportLeagueSeason: {
            ...(filters.sportLeagueId !== undefined && { sportLeagueId: filters.sportLeagueId }),
            ...((filters.activeSportLeaguesOnly || filters.sport !== undefined) && {
              sportLeague: {
                ...(filters.activeSportLeaguesOnly && { isActive: true }),
                // The event's sport is its sport league's (#2042).
                ...(filters.sport !== undefined && { sport: { sport: filters.sport } }),
              },
            }),
          },
        }),
        ...(filters.sportLeagueSeasonId !== undefined && { sportLeagueSeasonId: filters.sportLeagueSeasonId }),
        ...(filters.slotDefinitionIds !== undefined && {
          slots: { some: { seasonSlot: { sportLeagueCompetitionSlotId: { in: [...filters.slotDefinitionIds] } } } },
        }),
        ...(filters.q !== undefined && { name: { contains: filters.q, mode: 'insensitive' as const } }),
        ...(filters.releasedOnly && { NOT: { status: SportEventStatus.DRAFT } }),
        ...((filters.startsFrom !== undefined || filters.startsBefore !== undefined) && {
          startDate: { gte: filters.startsFrom, lt: filters.startsBefore },
        }),
      },
      include: SPORT_EVENT_INCLUDE,
      orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toSportEvent);
  }

  async createMany(inputs: readonly SportEventCreate[]): Promise<SportEvent[]> {
    if (inputs.length === 0) return [];
    // Each event is given its id here, so the rows read back can be put back in the order given.
    const ids = inputs.map(() => randomUUID());
    const mappings = await this.providerMappingRows(inputs, ids);
    await this.prisma.$transaction(async (tx) => {
      await tx.sportEvent.createMany({
        data: inputs.map((input, index) => ({
          id: ids[index],
          name: input.name,
          venue: input.venue ?? null,
          location: input.location ?? null,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          status: input.status,
          rounds: input.rounds ?? null,
          roundsPar: input.roundsPar ?? null,
          sportLeagueId: input.sportLeagueId,
          sportLeagueSeasonId: input.sportLeagueSeasonId,
          autoLifecycleEnabled: input.autoLifecycleEnabled,
        })),
      });
      if (mappings.length > 0) await tx.sportEventProviderMapping.createMany({ data: mappings });
      const slots = inputs.flatMap((input, index) => (input.seasonSlotIds ?? []).map((sportLeagueSeasonCompetitionSlotId) => ({
        sportEventId: ids[index],
        sportLeagueSeasonId: input.sportLeagueSeasonId,
        sportLeagueSeasonCompetitionSlotId,
      })));
      if (slots.length > 0) await tx.sportEventSlot.createMany({ data: slots });
    });
    const rows = await this.prisma.sportEvent.findMany({ where: { id: { in: ids } }, include: SPORT_EVENT_INCLUDE });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = rowById.get(id);
      if (!row) throw new Error(`The insert did not write sport event ${id}.`);
      return toSportEvent(row);
    });
  }

  /**
   * The provider mapping row of each new event the sync gives a provider id (#2004), under its
   * Season's league's selected provider mapping, in one read. A ref of a provider that is not that
   * league's sync provider is a broken caller, and throws before anything is written.
   */
  private async providerMappingRows(inputs: readonly SportEventCreate[], ids: readonly string[]): Promise<Prisma.SportEventProviderMappingCreateManyInput[]> {
    const seasonIds = [...new Set(inputs.flatMap((input) => (input.providerRef === undefined ? [] : [input.sportLeagueSeasonId])))];
    if (seasonIds.length === 0) return [];
    const seasons = await this.prisma.sportLeagueSeason.findMany({
      where: { id: { in: seasonIds } },
      select: {
        id: true,
        sportLeague: { select: { selectedProviderMapping: { select: { id: true, providerLeague: { select: { provider: { select: { id: true, code: true } } } } } } } },
      },
    });
    const leagueOf = new Map(seasons.map((row) => [row.id, row.sportLeague]));
    return inputs.flatMap((input, index) => {
      if (input.providerRef === undefined) return [];
      const selected = leagueOf.get(input.sportLeagueSeasonId)?.selectedProviderMapping;
      if (selected === null || selected === undefined || providerSourceIdOf(selected.providerLeague.provider.code) !== input.providerRef.providerId) {
        throw new Error(`Season ${input.sportLeagueSeasonId}'s league is not synced from provider ${input.providerRef.providerId}.`);
      }
      return [{
        sportEventId: ids[index],
        providerId: selected.providerLeague.provider.id,
        sportLeagueProviderMappingId: selected.id,
        externalId: input.providerRef.externalId,
      }];
    });
  }

  async update(id: string, updates: SportEventUpdate, options: { jobs?: readonly BackgroundJobRequest[] } = {}): Promise<SportEvent> {
    const jobs = options.jobs ?? [];
    const write = (db: PrismaClient | Prisma.TransactionClient) => db.sportEvent.update({
      where: { id },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.venue !== undefined && { venue: updates.venue }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.roundsPar !== undefined && { roundsPar: updates.roundsPar }),
        ...(updates.autoLifecycleEnabled !== undefined && { autoLifecycleEnabled: updates.autoLifecycleEnabled }),
        ...(updates.status !== undefined && { status: updates.status }),
      },
      include: SPORT_EVENT_INCLUDE,
    });
    return toSportEvent(await forgettingReads(ReadMemoKey.sportEvent, () => (jobs.length > 0
      ? this.prisma.$transaction(async (tx) => {
        const row = await write(tx);
        await insertBackgroundJobs(tx, jobs);
        return row;
      })
      : write(this.prisma))));
  }

  async transitionStatus(id: string, transition: SportEventStatusTransition): Promise<SportEvent | null> {
    const jobs = transition.jobs ?? [];
    const move = async (db: PrismaClient | Prisma.TransactionClient): Promise<boolean> => {
      const result = await db.sportEvent.updateMany({
        where: { id, status: transition.from },
        data: {
          status: transition.to,
          ...(transition.endDate && { endDate: transition.endDate }),
          ...(transition.releasedAt && { releasedAt: transition.releasedAt }),
        },
      });
      if (result.count > 0 && jobs.length > 0) await insertBackgroundJobs(db, jobs);
      return result.count > 0;
    };
    const moved = await forgettingReads(ReadMemoKey.sportEvent, () => (jobs.length > 0 ? this.prisma.$transaction(move) : move(this.prisma)));
    return moved ? this.findById(id) : null;
  }

  async delete(id: string): Promise<void> {
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction(this.eventDeletes(id)));
  }

  async deleteTestSlot(seasonSlotId: string, sportEventId: string | null): Promise<number> {
    // The test participants this slot's field held: only those can be left on no field by it.
    const fieldIds = sportEventId === null ? [] : (await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId }, select: { participantId: true },
    })).map((row) => row.participantId);
    const results = await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction([
      ...(sportEventId === null ? [] : this.eventDeletes(sportEventId)),
      this.prisma.sportLeagueSeasonCompetitionSlot.deleteMany({ where: { id: seasonSlotId, isTestData: true } }),
      // After the field rows went in the same transaction, so "no field" counts this event's as gone.
      this.prisma.participant.deleteMany({ where: { id: { in: fieldIds }, isTestData: true, sportEventParticipants: { none: {} } } }),
    ]));
    const removed = results.at(-1) as { count: number };
    return removed.count;
  }

  /** The event's delete, children first: every child holds a RESTRICT foreign key. */
  private eventDeletes(id: string) {
    // Extension rows before their core rows. Deleting only the event row failed for any event with a round.
    const field = { sportEventParticipant: { sportEventId: id } };
    return [
      // The bracket first: its matches name field rows and rounds.
      this.prisma.sportEventRoundMatch.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: field } }),
      this.prisma.sportEventParticipantRound.deleteMany({ where: field }),
      this.prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: field } }),
      this.prisma.sportEventParticipantStanding.deleteMany({ where: field }),
      this.prisma.sportEventParticipantValuation.deleteMany({ where: field }),
      this.prisma.sportEventParticipant.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventRound.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEventTier.deleteMany({ where: { sportEventId: id } }),
      this.prisma.sportEvent.delete({ where: { id } }),
    ];
  }

  async countParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countUntieredActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: {
        sportEventId: { in: [...sportEventIds] },
        isActive: true,
        // A tierless row auto-tiering left beyond a capped last tier has a source (#1844): it is
        // out of the tiers by the league's layout, not waiting for one.
        OR: [{ valuation: null }, { valuation: { sportEventTierId: null, tierAssignedSource: null } }],
      },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countUnpricedActiveParticipants(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventParticipant.groupBy({
      by: ['sportEventId'],
      where: {
        sportEventId: { in: [...sportEventIds] },
        isActive: true,
        OR: [{ valuation: null }, { valuation: { price: null } }],
      },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countTiers(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.sportEventTier.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async isTestEvent(sportEventId: string): Promise<boolean | null> {
    // One read answers both: the event row, remembered for the request's later point reads of it
    // (the write behind the guard reads the event again), and whether it covers a test slot.
    const row = await this.prisma.sportEvent.findUnique({
      where: { id: sportEventId },
      include: { ...SPORT_EVENT_INCLUDE, _count: { select: { slots: { where: COVERS_TEST_SLOT } } } },
    });
    if (row === null) return null;
    await memoizedReadMany(this.prisma, ReadMemoKey.sportEvent, [sportEventId], () => Promise.resolve([toSportEvent(row)]));
    return row._count.slots > 0;
  }

  async findSlots(sportEventIds: readonly string[]): Promise<Map<string, SportLeagueSeasonSlot[]>> {
    if (sportEventIds.length === 1) {
      const [onlyId] = sportEventIds;
      // One event's slots need no link back to it: two reads, the slots and their definitions.
      const slots = await this.prisma.sportLeagueSeasonCompetitionSlot.findMany({
        where: { eventSlot: { sportEventId: onlyId } },
        select: SEASON_SLOT_SELECT,
      });
      return new Map([[onlyId, slots.map(toSeasonSlot).sort(compareSeasonSlots)]]);
    }
    const rows = await this.prisma.sportEventSlot.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      select: { sportEventId: true, seasonSlot: { select: SEASON_SLOT_SELECT } },
    });
    const slotsByEvent = new Map(sportEventIds.map((id): [string, SportLeagueSeasonSlot[]] => [id, []]));
    for (const row of rows) slotsByEvent.get(row.sportEventId)?.push(toSeasonSlot(row.seasonSlot));
    for (const slots of slotsByEvent.values()) slots.sort(compareSeasonSlots);
    return slotsByEvent;
  }

  async findEmptyTierLabels(sportEventIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.sportEventTier.findMany({
      where: {
        sportEventId: { in: [...sportEventIds] },
        valuations: { none: { sportEventParticipant: { status: SportEventParticipantStatus.ACTIVE } } },
      },
      select: { sportEventId: true, label: true },
      orderBy: { tierNumber: 'asc' },
    });
    const labels = new Map<string, string[]>(sportEventIds.map((id) => [id, []]));
    for (const row of rows) {
      labels.get(row.sportEventId)?.push(row.label);
    }
    return labels;
  }

  async findReleaseFacts(event: { id: string; sportLeagueId: string }): Promise<SportEventReleaseFacts> {
    const [scheduledRoundCount, contestSetupCount] = await Promise.all([
      this.prisma.sportEventRound.count({ where: { sportEventId: event.id } }),
      // The setups a commissioner could make a contest on the event from: every setup belongs to one sport league (#1825).
      this.prisma.contestConfigTemplate.count({ where: { active: true, sportLeagueId: event.sportLeagueId } }),
    ]);
    return { scheduledRoundCount, contestSetupCount };
  }

  async findAutoReleaseCandidates(now: Date, horizon: Date): Promise<SportEventAutoReleaseCandidate[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        status: SportEventStatus.DRAFT,
        startDate: { gt: now, lte: horizon },
        sportLeagueSeason: { sportLeague: { isActive: true, selectedProviderMappingId: { not: null }, autoReleaseDaysBeforeStart: { not: null } } },
        // A test event is released by hand only (#2004).
        slots: { none: COVERS_TEST_SLOT },
      },
      select: {
        id: true,
        startDate: true,
        sportLeagueSeason: { select: { sportLeague: { select: { ...SYNC_PROVIDER_SELECT, autoReleaseDaysBeforeStart: true } } } },
      },
      orderBy: { startDate: 'asc' },
    });
    return rows.flatMap((row) => {
      const { autoReleaseDaysBeforeStart } = row.sportLeagueSeason.sportLeague;
      const syncProviderId = syncProviderIdOf(row.sportLeagueSeason.sportLeague);
      if (syncProviderId === null || autoReleaseDaysBeforeStart === null) return [];
      return [{ id: row.id, startDate: row.startDate, syncProviderId, autoReleaseDaysBeforeStart }];
    });
  }

  async recordAutoReleaseCheck(sportEventId: string, check: AutoReleaseCheck | null): Promise<void> {
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        autoReleaseCheckedAt: check?.checkedAt ?? null,
        autoReleaseOutcome: check?.outcome ?? null,
        autoReleaseFailedChecks: check?.failedChecks ?? [],
      },
      select: { id: true },
    }));
  }

  async findAutoReleaseCheck(sportEventId: string): Promise<AutoReleaseCheck | null> {
    const row = await this.prisma.sportEvent.findUnique({
      where: { id: sportEventId },
      select: { autoReleaseCheckedAt: true, autoReleaseOutcome: true, autoReleaseFailedChecks: true },
    });
    // The check constraint sets the time and the outcome together.
    if (row?.autoReleaseCheckedAt == null || row.autoReleaseOutcome === null) return null;
    return { checkedAt: row.autoReleaseCheckedAt, outcome: row.autoReleaseOutcome, failedChecks: row.autoReleaseFailedChecks };
  }

  async countContests(sportEventIds: readonly string[]): Promise<Map<string, number>> {
    // A contest covers its events through contest_sport_events (#713): one row per contest and event.
    const groups = await this.prisma.contestSportEvent.groupBy({
      by: ['sportEventId'],
      where: { sportEventId: { in: [...sportEventIds] } },
      _count: { _all: true },
    });
    return countMap(sportEventIds, groups.map((group) => [group.sportEventId, group._count._all]));
  }

  async countBySportLeagues(sportLeagueIds: readonly string[]): Promise<Map<string, number>> {
    // groupBy cannot group through a relation, so the events are counted per Season and the
    // Seasons folded into their sport league.
    const seasons = await this.prisma.sportLeagueSeason.findMany({
      where: { sportLeagueId: { in: [...sportLeagueIds] } },
      select: { id: true, sportLeagueId: true },
    });
    const groups = await this.prisma.sportEvent.groupBy({
      by: ['sportLeagueSeasonId'],
      where: { sportLeagueSeasonId: { in: seasons.map((row) => row.id) } },
      _count: { _all: true },
    });
    const leagueBySeason = new Map(seasons.map((row) => [row.id, row.sportLeagueId]));
    const counts = new Map(sportLeagueIds.map((id) => [id, 0]));
    for (const group of groups) {
      const sportLeagueId = leagueBySeason.get(group.sportLeagueSeasonId);
      if (sportLeagueId) counts.set(sportLeagueId, (counts.get(sportLeagueId) ?? 0) + group._count._all);
    }
    return counts;
  }

  async summarizeByProviders(providerIds: readonly string[]): Promise<Map<string, SportEventProviderSummary>> {
    // An adapter id no Provider carries has no events.
    const codes = providerIds.flatMap((providerId) => {
      const code = providerCodeOfSourceId(providerId);
      return code === undefined ? [] : [[providerId, code] as const];
    });
    const codeOf = new Map(codes);
    const [active, latest] = await Promise.all([
      // An event has one mapping per provider, so its mappings count its events.
      this.prisma.sportEventProviderMapping.groupBy({
        by: ['providerId'],
        where: {
          provider: { code: { in: codes.map(([, code]) => code) } },
          sportEvent: { status: { in: [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS] } },
        },
        _count: { _all: true },
      }),
      // One read per provider, and there are a handful (one today): the latest change of its events.
      // poolmaster-allow-query-in-loop: one read per registered provider, a small fixed bound (one today)
      Promise.all(codes.map(async ([providerId, code]) => [providerId, (await this.prisma.sportEvent.aggregate({
        where: { providerMappings: { some: { provider: { code } } } },
        _max: { updatedAt: true },
      }))._max.updatedAt] as const)),
    ]);
    const providerRows = await this.prisma.provider.findMany({ where: { code: { in: codes.map(([, code]) => code) } }, select: { id: true, code: true } });
    const codeOfRow = new Map(providerRows.map((row) => [row.id, row.code]));
    const activeByCode = new Map(active.map((group) => [codeOfRow.get(group.providerId), group._count._all]));
    const lastChanged = new Map(latest);
    return new Map(providerIds.map((providerId) => [providerId, {
      activeEventCount: activeByCode.get(codeOf.get(providerId)) ?? 0,
      lastChangedAt: lastChanged.get(providerId) ?? null,
    }]));
  }

  async findLiveNotifiedEvents(query: ProviderNotifiedEventQuery): Promise<ProviderNotifiedEvent[]> {
    const { startedBy } = query;
    if ('sportEventIds' in query && query.sportEventIds.length === 0) return [];
    const providerCode = requireProviderCodeOfSourceId(query.providerId);
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        ...sportEventSportWhere(query.sport),
        ...('sportEventIds' in query && { id: { in: [...query.sportEventIds] } }),
        providerMappings: {
          some: { provider: { code: providerCode }, ...('externalId' in query && { externalId: query.externalId }) },
        },
        ...(startedBy === undefined
          ? { status: SportEventStatus.IN_PROGRESS }
          : {
              OR: [
                { status: SportEventStatus.IN_PROGRESS },
                { status: SportEventStatus.SCHEDULED, autoLifecycleEnabled: true, startDate: { lte: startedBy } },
              ],
            }),
      },
      select: {
        id: true,
        ...SPORT_EVENT_SPORT_SELECT,
        providerMappings: { where: { provider: { code: providerCode } }, select: { externalId: true } },
        status: true,
      },
    });
    // The where clause keeps only events with a mapping of this provider, and an event has one.
    return rows.flatMap((row) => row.providerMappings.map((mapping) => ({
      sportEventId: row.id,
      sport: sportOfEvent(row),
      providerId: query.providerId,
      externalId: mapping.externalId,
      inProgress: row.status === SportEventStatus.IN_PROGRESS,
    })));
  }

  async recordProviderNotification(receipt: ProviderNotificationReceipt): Promise<void> {
    if (receipt.externalIds.length === 0) return;
    await this.prisma.sportEvent.updateMany({
      where: { providerMappings: { some: { provider: { code: requireProviderCodeOfSourceId(receipt.providerId) }, externalId: { in: [...receipt.externalIds] } } } },
      data: { lastProviderNotificationAt: receipt.receivedAt },
    });
  }

  async findAutoLifecycleCandidates(): Promise<AutoLifecycleCandidate[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        autoLifecycleEnabled: true,
        status: { in: [...AUTO_LIFECYCLE_STATUSES] },
      },
      include: SPORT_EVENT_INCLUDE,
    });
    // The query keeps to these statuses; the filter tells the type so.
    return rows.map(toSportEvent).filter(isAutoLifecycleCandidate);
  }
}

export class PrismaSportEventRoundRepository implements SportEventRoundRepository {
  constructor(private readonly prisma: Db) {}

  async findResultFacts(sportEventId: string): Promise<Map<string, RoundResultFacts>> {
    const [matches, participantRounds] = await Promise.all([
      this.prisma.sportEventRoundMatch.groupBy({
        by: ['sportEventRoundId', 'status'],
        where: { sportEventId },
        _count: { _all: true },
        _max: { completedAt: true },
      }),
      this.prisma.sportEventParticipantRound.groupBy({
        by: ['sportEventRoundId', 'status'],
        where: { sportEventRound: { sportEventId } },
        _count: { _all: true },
        _max: { completedAt: true },
      }),
    ]);
    const facts = new Map<string, { matches: RoundResultGroup<MatchStatus>[]; participantRounds: RoundResultGroup<ParticipantRoundStatus>[] }>();
    const factsOf = (roundId: string) => {
      const existing = facts.get(roundId);
      if (existing) return existing;
      const created = { matches: [], participantRounds: [] };
      facts.set(roundId, created);
      return created;
    };
    for (const group of matches) {
      factsOf(group.sportEventRoundId).matches.push({ status: group.status, count: group._count._all, lastCompletedAt: group._max.completedAt });
    }
    for (const group of participantRounds) {
      factsOf(group.sportEventRoundId).participantRounds.push({ status: group.status, count: group._count._all, lastCompletedAt: group._max.completedAt });
    }
    return facts;
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventRound[]> {
    const rows = await this.prisma.sportEventRound.findMany({
      where: { sportEventId },
      include: ROUND_SLOT_INCLUDE,
      orderBy: { roundNumber: 'asc' },
    });
    return rows.map(toSportEventRound);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<Map<string, SportEventRound[]>> {
    const rounds = new Map<string, SportEventRound[]>(sportEventIds.map((id) => [id, []]));
    if (sportEventIds.length === 0) return rounds;
    const rows = await this.prisma.sportEventRound.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      include: ROUND_SLOT_INCLUDE,
      orderBy: { roundNumber: 'asc' },
    });
    for (const row of rows) rounds.get(row.sportEventId)?.push(toSportEventRound(row));
    return rounds;
  }

  async createMany(rounds: readonly SportEventRoundCreate[]): Promise<void> {
    if (rounds.length === 0) return;
    // Each round's event slot row, found by its event and Season slot: one read for every round.
    const eventSlots = await this.prisma.sportEventSlot.findMany({
      where: { sportEventId: { in: [...new Set(rounds.map((round) => round.sportEventId))] } },
      select: { id: true, sportEventId: true, sportLeagueSeasonCompetitionSlotId: true },
    });
    // A Season slot is covered by one event at most, so it names its event slot row.
    const eventSlotOf = new Map(eventSlots.map((row) => [row.sportLeagueSeasonCompetitionSlotId, row]));
    await this.prisma.sportEventRound.createMany({
      data: rounds.map((round) => ({
        sportEventSlotId: requiredEventSlotId(eventSlotOf, round),
        sportEventId: round.sportEventId,
        roundNumber: round.roundNumber,
        scheduledDate: round.scheduledDate,
        scheduledEndAt: round.scheduledEndAt ?? null,
      })),
    });
  }

  async reschedule(sportEventId: string, rounds: readonly SportEventRoundSchedule[]): Promise<void> {
    // poolmaster-allow-query-in-loop: one event's handful of rounds (per-row values, one transaction)
    await this.prisma.$transaction(rounds.map((round) => this.prisma.sportEventRound.update({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber: round.roundNumber } },
      data: {
        scheduledDate: round.scheduledDate,
        ...(round.scheduledEndAt !== undefined && { scheduledEndAt: round.scheduledEndAt }),
      },
    })));
  }

  async findOrCreate(sportEventId: string, roundNumber: number): Promise<SportEventRound> {
    const stored = await this.prisma.sportEventRound.findUnique({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
      include: ROUND_SLOT_INCLUDE,
    });
    if (stored !== null) return toSportEventRound(stored);
    // A round made for a score is played in the event's one slot.
    const eventSlots = await this.prisma.sportEventSlot.findMany({ where: { sportEventId }, select: { id: true }, take: 2 });
    if (eventSlots.length !== 1) {
      throw new Error(`Sport event ${sportEventId} has ${eventSlots.length === 0 ? 'no slot' : 'several slots'}, so a round cannot be made for a score in round ${roundNumber}.`);
    }
    return toSportEventRound(await this.prisma.sportEventRound.upsert({
      where: { sportEventId_roundNumber: { sportEventId, roundNumber } },
      create: { sportEventId, sportEventSlotId: eventSlots[0].id, roundNumber, scheduledDate: new Date() },
      update: {},
      include: ROUND_SLOT_INCLUDE,
    }));
  }
}

/** A field in seed order, unseeded last, then by name. */
const FIELD_ORDER = [
  { seedNumber: { sort: 'asc', nulls: 'last' } },
  { participant: { name: 'asc' } },
] satisfies Prisma.SportEventParticipantOrderByWithRelationInput[];

/**
 * Everything a field row is read with (#1163). Prisma 6 reads each relation with its own
 * statement on one connection, so the whole field is a handful of sequential queries; empty
 * relations, such as a golf event's race results, return nothing.
 */
function fieldRowInclude() {
  return {
    participant: true,
    valuation: true,
    standing: { include: { golf: true } },
    rounds: {
      include: { sportEventRound: { select: { roundNumber: true } }, golf: true },
      orderBy: { sportEventRound: { roundNumber: 'asc' } },
    },
    raceResult: true,
    matchSides: { select: { match: { include: MATCH_INCLUDE } } },
  } satisfies Prisma.SportEventParticipantInclude;
}

type FieldRow = Prisma.SportEventParticipantGetPayload<{ include: ReturnType<typeof fieldRowInclude> }>;

/** A field row, flagged when its participant belongs to `sportLeagueId`, its event's. */
function toFieldRow(row: FieldRow, sportLeagueId: string): SportEventParticipantView {
  const { participant, valuation, standing, rounds, raceResult, matchSides, ...entry } = row;
  return {
    entry: toSportEventParticipant(entry),
    participant: mapToParticipant(participant),
    valuation: valuation ? toValuation(valuation) : null,
    standing: standing
      ? {
        standing: {
          id: standing.id,
          sportEventParticipantId: standing.sportEventParticipantId,
          position: standing.position,
          displayPosition: standing.displayPosition,
          status: standing.status,
          asOf: standing.asOf,
          currentRound: standing.currentRound,
          createdAt: standing.createdAt,
          updatedAt: standing.updatedAt,
        },
        golf: standing.golf ? toGolfStanding(standing.golf) : null,
      }
      : null,
    rounds: rounds.map((round) => ({
      round: {
        id: round.id,
        sportEventParticipantId: round.sportEventParticipantId,
        sportEventRoundId: round.sportEventRoundId,
        roundNumber: round.sportEventRound.roundNumber,
        status: round.status,
        completedAt: round.completedAt,
        createdAt: round.createdAt,
        updatedAt: round.updatedAt,
      },
      golf: round.golf ? toGolfRound(round.golf) : null,
    })),
    raceResult: raceResult ? toRaceResult(raceResult) : null,
    matches: matchSides
      .map((side) => toSportEventRoundMatch(side.match))
      .sort(compareMatchPlaces),
    affiliatedWithSportLeague: participant.sportLeagueId === sportLeagueId,
  };
}

export class PrismaSportEventParticipantRepository implements SportEventParticipantRepository {
  constructor(private readonly prisma: Db) {}

  async findById(id: string): Promise<SportEventParticipant | null> {
    const row = await this.prisma.sportEventParticipant.findUnique({ where: { id } });
    return row ? toSportEventParticipant(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<SportEventParticipant[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.sportEventParticipant.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toSportEventParticipant);
  }

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipant[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({ where: { sportEventId }, orderBy: FIELD_ORDER });
    return rows.map(toSportEventParticipant);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipant[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      orderBy: [{ sportEventId: 'asc' }, ...FIELD_ORDER],
    });
    return rows.map(toSportEventParticipant);
  }

  async findFieldForEvent(sportEventId: string, sportLeagueId: string): Promise<SportEventParticipantView[]> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      include: fieldRowInclude(),
      orderBy: FIELD_ORDER,
    });
    return rows.map((row) => toFieldRow(row, sportLeagueId));
  }

  async findFieldsForEvents(events: readonly { sportEventId: string; sportLeagueId: string }[]): Promise<SportEventParticipantView[]> {
    if (events.length === 0) return [];
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: events.map((event) => event.sportEventId) } },
      include: fieldRowInclude(),
      orderBy: FIELD_ORDER,
    });
    return events.flatMap(({ sportEventId, sportLeagueId }) => rows
      .filter((row) => row.sportEventId === sportEventId)
      .map((row) => toFieldRow(row, sportLeagueId)));
  }

  async findFieldRow(sportEventId: string, sportEventParticipantId: string, sportLeagueId: string): Promise<SportEventParticipantView | null> {
    const row = await this.prisma.sportEventParticipant.findFirst({
      where: { id: sportEventParticipantId, sportEventId },
      include: fieldRowInclude(),
    });
    return row ? toFieldRow(row, sportLeagueId) : null;
  }

  async countDistinctParticipants(sportEventIds: readonly string[]): Promise<number> {
    const rows = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      distinct: ['participantId'],
      select: { participantId: true },
    });
    return rows.length;
  }

  async createMany(sportEventId: string, rows: readonly SportEventParticipantCreate[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const create = this.prisma.sportEventParticipant.createMany({
      data: rows.map((row) => ({ sportEventId, participantId: row.participantId, ...fieldPatch(row) })),
    });
    await (jobs.length === 0 ? create : this.prisma.$transaction([create, backgroundJobsInsert(this.prisma, jobs)]));
  }

  /**
   * One save of the field grid (#1252): rows given the same change share one update, and every
   * manual price is written with the valuations' fixed-count rewrite. A row whose patch is empty
   * writes nothing.
   */
  async updateMany(entries: readonly SportEventParticipantFieldUpdate[], jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const idsByPatch = new Map<string, { data: ReturnType<typeof fieldPatch>; ids: string[] }>();
    for (const entry of entries) {
      const data = fieldPatch(entry.updates);
      if (Object.keys(data).length === 0) continue;
      const key = JSON.stringify(data);
      const group = idsByPatch.get(key) ?? { data, ids: [] };
      group.ids.push(entry.id);
      idsByPatch.set(key, group);
    }
    // A row's price and tier move land in the one valuation write, so the save stands or falls whole.
    const valuations: ValuationChange[] = entries.flatMap((entry) => (entry.price === undefined && entry.tier === undefined
      ? []
      : [{
        sportEventParticipantId: entry.id,
        ...(entry.price === undefined ? {} : { price: entry.price, priceAssignedSource: ValuationSource.MANUAL }),
        ...(entry.tier === undefined ? {} : { ...entry.tier, tierAssignedSource: ValuationSource.MANUAL }),
      }]));
    await this.prisma.$transaction(async (tx) => {
      const groups = [...idsByPatch.values()];
      // poolmaster-allow-query-in-loop: one updateMany per distinct patch; rows given the same values share one
      const results = await Promise.all(groups.map(({ data, ids }) => tx.sportEventParticipant.updateMany({ where: { id: { in: ids } }, data })));
      // An update of a missing row fails, as one update per row would, so none of the save stands.
      if (results.some((result, index) => result.count !== new Set(groups[index].ids).size)) {
        throw new Error('A field row to update does not exist.');
      }
      await rewriteValuations(tx, valuations);
      await insertBackgroundJobs(tx, jobs);
    });
  }

  async delete(id: string, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    const own = { sportEventParticipantId: id };
    await this.prisma.$transaction([
      this.prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: own } }),
      this.prisma.sportEventParticipantRound.deleteMany({ where: own }),
      this.prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: own } }),
      this.prisma.sportEventParticipantStanding.deleteMany({ where: own }),
      this.prisma.sportEventParticipantValuation.deleteMany({ where: own }),
      this.prisma.sportEventParticipant.delete({ where: { id } }),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }

  async countPicks(id: string): Promise<number> {
    return this.prisma.contestEntryPick.count({ where: { sportEventParticipantId: id } });
  }

  async fillPlayInSlot(input: { id: string; winnerParticipantId: string; pairingParticipantId: string }, jobs: readonly BackgroundJobRequest[] = []): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sportEventParticipant.update({ where: { id: input.id }, data: { participantId: input.winnerParticipantId, isPlayInPlace: false } }),
      this.prisma.participant.update({ where: { id: input.pairingParticipantId }, data: { status: ParticipantStatus.INACTIVE } }),
      ...(jobs.length > 0 ? [backgroundJobsInsert(this.prisma, jobs)] : []),
    ]);
  }
}

export class PrismaSportEventTierRepository implements SportEventTierRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventTier[]> {
    const rows = await this.prisma.sportEventTier.findMany({ where: { sportEventId }, orderBy: { tierNumber: 'asc' } });
    return rows.map(toTier);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventTier[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventTier.findMany({
      where: { sportEventId: { in: [...sportEventIds] } },
      orderBy: [{ sportEventId: 'asc' }, { tierNumber: 'asc' }],
    });
    return rows.map(toTier);
  }

  async createMany(tiers: readonly SportEventTierCreate[]): Promise<void> {
    if (tiers.length === 0) return;
    await this.prisma.sportEventTier.createMany({
      data: tiers.map((tier) => ({ sportEventId: tier.sportEventId, ...tierColumns(tier) })),
    });
  }

  async replace(sportEventId: string, tiers: readonly SportEventTierDefinition[], reassignTo?: string): Promise<void> {
    const keep = new Set(tiers.map((tier) => tier.tierKey));
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sportEventTier.findMany({ where: { sportEventId } });
      const existingByKey = new Map(existing.map((tier) => [tier.tierKey, tier]));
      const removed = existing.filter((tier) => !keep.has(tier.tierKey));
      const changed = tiers.flatMap((tier) => {
        const before = existingByKey.get(tier.tierKey);
        return before && (before.label !== tier.label || before.tierNumber !== tier.tierNumber) ? [{ id: before.id, tier }] : [];
      });
      const added = tiers.filter((tier) => !existingByKey.has(tier.tierKey));
      // Park every number that moves or goes away below zero in one statement first (tier numbers
      // start at 1), so two tiers swapping numbers, or a new tier taking a removed one's, never
      // collide on the (sportEventId, tierNumber) unique index.
      const parkedIds = [...changed.map(({ id }) => id), ...removed.map((tier) => tier.id)];
      if (parkedIds.length > 0) {
        await tx.sportEventTier.updateMany({ where: { id: { in: parkedIds } }, data: { tierNumber: { multiply: -1 } } });
      }
      // Each changed tier takes its own label and number, so these stay one statement apiece;
      // valuations point at a tier, so a tier cannot be deleted and inserted again instead.
      for (const { id, tier } of changed) {
        // poolmaster-allow-query-in-loop: only the tiers whose label or number changed, of an event's handful
        await tx.sportEventTier.update({ where: { id }, data: { label: tier.label, tierNumber: tier.tierNumber } });
      }
      if (added.length > 0) {
        await tx.sportEventTier.createMany({ data: added.map((tier) => ({ sportEventId, ...tierColumns(tier) })) });
      }
      if (removed.length === 0) {
        return;
      }
      const target = reassignTo
        ? existingByKey.get(reassignTo)
          ?? await tx.sportEventTier.findUniqueOrThrow({ where: { sportEventId_tierKey: { sportEventId, tierKey: reassignTo } } })
        : null;
      const removedIds = removed.map((tier) => tier.id);
      // A valuation left with no tier loses its source too: a tierless row with a source is one
      // auto-tiering placed beyond a capped last tier (#1844), which release doesn't wait on.
      await tx.sportEventParticipantValuation.updateMany({
        where: { sportEventTierId: { in: removedIds } },
        data: target ? { sportEventTierId: target.id, tierOrderIndex: null } : { sportEventTierId: null, tierOrderIndex: null, tierAssignedSource: null },
      });
      await tx.sportEventTier.deleteMany({ where: { id: { in: removedIds } } });
    });
  }

  async countValuations(sportEventId: string): Promise<Map<string, number>> {
    // Grouped from the valuations, filtered to the event's tiers: a relation `_count` on the tiers
    // groups every valuation of every event before joining.
    const groups = await this.prisma.sportEventParticipantValuation.groupBy({
      by: ['sportEventTierId'],
      where: { sportEventTier: { sportEventId } },
      _count: { _all: true },
    });
    return new Map(groups.flatMap((group) => (group.sportEventTierId === null ? [] : [[group.sportEventTierId, group._count._all]])));
  }
}

export class PrismaSportEventParticipantValuationRepository implements SportEventParticipantValuationRepository {
  constructor(private readonly prisma: Db) {}

  async findBySportEvent(sportEventId: string): Promise<SportEventParticipantValuation[]> {
    return this.findBySportEvents([sportEventId]);
  }

  async findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventParticipantValuation[]> {
    if (sportEventIds.length === 0) return [];
    const rows = await this.prisma.sportEventParticipantValuation.findMany({
      where: { sportEventParticipant: { sportEventId: { in: [...sportEventIds] } } },
      orderBy: [{ sportEventTier: { tierNumber: 'asc' } }, { tierOrderIndex: 'asc' }],
    });
    return rows.map(toValuation);
  }

  async assignTiers(assignments: readonly TierAssignment[]): Promise<void> {
    await this.prisma.$transaction((tx) => rewriteValuations(tx, assignments.map((assignment) => ({
      sportEventParticipantId: assignment.sportEventParticipantId,
      sportEventTierId: assignment.sportEventTierId,
      tierOrderIndex: assignment.tierOrderIndex,
      tierAssignedSource: assignment.source,
    }))));
  }

  async assignEventTiers(input: {
    sportEventId: string;
    tierConfig: EventTierConfig;
    assignments: readonly TierAssignment[];
  }): Promise<void> {
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction(async (tx) => {
      await rewriteValuations(tx, input.assignments.map((assignment) => ({
        sportEventParticipantId: assignment.sportEventParticipantId,
        sportEventTierId: assignment.sportEventTierId,
        tierOrderIndex: assignment.tierOrderIndex,
        tierAssignedSource: assignment.source,
      })));
      await tx.sportEvent.update({
        where: { id: input.sportEventId },
        data: { tierConfig: input.tierConfig },
      });
    }));
  }

  async assignEventPrices(input: {
    sportEventId: string;
    pricingConfig: EventPricingConfig;
    assignments: readonly PriceAssignment[];
  }): Promise<void> {
    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.$transaction(async (tx) => {
      await rewriteValuations(tx, input.assignments.map((assignment) => ({
        sportEventParticipantId: assignment.sportEventParticipantId,
        price: assignment.price,
        priceAssignedSource: assignment.source,
      })));
      await tx.sportEvent.update({
        where: { id: input.sportEventId },
        data: { pricingConfig: input.pricingConfig },
      });
    }));
  }
}

/** A change to one field row's valuation: its tier columns, its price columns, or both. */
type ValuationChange = { sportEventParticipantId: string } & Partial<Pick<
  Prisma.SportEventParticipantValuationUncheckedCreateInput,
  'sportEventTierId' | 'tierOrderIndex' | 'tierAssignedSource' | 'price' | 'priceAssignedSource'
>>;

/**
 * Writes each field row's valuation change in three statements, however many rows change
 * (#1252). Prisma has no update of many rows to different values, and nothing points at a
 * valuation row, so the changed rows are read, deleted and inserted again with the change
 * applied, each keeping its id, its creation time and the columns the change leaves alone. A
 * row with no valuation yet gets one. Runs inside the caller's transaction.
 */
async function rewriteValuations(tx: Prisma.TransactionClient, changes: readonly ValuationChange[]): Promise<void> {
  // A row changed twice keeps the later change, as two upserts in a row would leave it.
  const changeById = new Map<string, ValuationChange>();
  for (const change of changes) {
    changeById.set(change.sportEventParticipantId, { ...changeById.get(change.sportEventParticipantId), ...change });
  }
  if (changeById.size === 0) return;
  const existing = await tx.sportEventParticipantValuation.findMany({
    where: { sportEventParticipantId: { in: [...changeById.keys()] } },
  });
  const existingById = new Map(existing.map(({ updatedAt: _updatedAt, ...row }) => [row.sportEventParticipantId, row]));
  if (existing.length > 0) {
    await tx.sportEventParticipantValuation.deleteMany({ where: { id: { in: existing.map((row) => row.id) } } });
  }
  await tx.sportEventParticipantValuation.createMany({
    data: [...changeById.values()].map((change) => ({ ...existingById.get(change.sportEventParticipantId), ...change })),
  });
}

function countMap(ids: readonly string[], counted: Array<[string, number]>): Map<string, number> {
  const counts = new Map(ids.map((id) => [id, 0]));
  for (const [id, count] of counted) {
    counts.set(id, count);
  }
  return counts;
}

function toSport(row: Prisma.SportGetPayload<object>): SportConfig {
  return {
    id: row.id,
    sport: row.sport,
    urlSegment: row.urlSegment,
    displayOrder: row.displayOrder,
    tournamentFormat: row.tournamentFormat,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSportLeague(row: SportLeagueRow): SportLeague {
  return {
    id: row.id,
    sportId: row.sportId,
    name: row.name,
    urlSegment: row.urlSegment,
    currentSeasonId: row.currentSeasonId,
    timeZone: row.timeZone,
    isActive: row.isActive,
    selectedProviderMapping: toSelectedProviderMapping(row.selectedProviderMapping),
    autoReleaseDaysBeforeStart: row.autoReleaseDaysBeforeStart,
    platformTierProfileId: row.platformTierProfileId,
    platformPricingProfileId: row.platformPricingProfileId,
    matchPeriodLayout: row.matchPeriodLayout,
    squaresFromRound: row.squaresFromRound,
    noun: row.noun,
    displayOrder: row.displayOrder,
    participantType: row.participantType,
    scoringFamily: row.scoringFamily,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every SportEvent read carries its sport league through its Season (#2004), and what the league
 * plays differently from its sport: its period layout, first squares round,
 * participant type and scoring family; its Season's championship year (#2003); and the provider
 * ids the sync gave it, by provider name (#2004).
 */
const SPORT_EVENT_INCLUDE = {
  sportLeagueSeason: {
    select: {
      championshipYear: true,
      sportLeague: { select: { matchPeriodLayout: true, squaresFromRound: true, participantType: true, scoringFamily: true, ...SPORT_LEAGUE_SPORT_SELECT, ...SYNC_PROVIDER_SELECT } },
    },
  },
  providerMappings: {
    select: { externalId: true, provider: { select: { code: true, name: true } } },
    orderBy: { provider: { name: 'asc' } },
  },
  // The slot definitions it covers (#2010): where contest templates are offered on it.
  slots: { select: { seasonSlot: { select: { definition: { select: { id: true, key: true, slotKind: true, weekNumber: true, canEndTied: true, ...SLOT_PLACE_SELECT } } } } } },
} as const;

function toSportEvent(row: Prisma.SportEventGetPayload<{ include: typeof SPORT_EVENT_INCLUDE }>): SportEvent {
  const syncProviderId = syncProviderIdOf(row.sportLeagueSeason.sportLeague);
  const syncProviderName = syncProviderNameOf(row.sportLeagueSeason.sportLeague);
  return {
    id: row.id,
    providerMappings: row.providerMappings.map((mapping) => ({ providerCode: mapping.provider.code, providerName: mapping.provider.name, externalId: mapping.externalId })),
    sport: sportOfEvent(row),
    sportUrlSegment: sportUrlSegmentOfEvent(row),
    name: row.name,
    venue: row.venue ?? undefined,
    location: row.location ?? undefined,
    startDate: row.startDate,
    endDate: row.endDate ?? undefined,
    status: row.status,
    rounds: row.rounds ?? undefined,
    roundsPar: row.roundsPar ?? undefined,
    participantCount: row.participantCount ?? undefined,
    slotDefinitions: row.slots
      .map(({ seasonSlot: { definition } }) => ({ ...definition, ...slotPlaceOf(definition) }))
      .sort(compareCoveredSlots)
      .map((definition) => ({ id: definition.id, slotKind: definition.slotKind, canEndTied: definition.canEndTied })),
    sportLeagueSeasonId: row.sportLeagueSeasonId,
    championshipYear: row.sportLeagueSeason.championshipYear,
    sportLeagueId: row.sportLeagueId,
    ...(row.sportLeagueSeason.sportLeague.matchPeriodLayout !== null && { matchPeriodLayout: row.sportLeagueSeason.sportLeague.matchPeriodLayout }),
    ...(row.sportLeagueSeason.sportLeague.squaresFromRound !== null && { squaresFromRound: row.sportLeagueSeason.sportLeague.squaresFromRound }),
    participantType: row.sportLeagueSeason.sportLeague.participantType,
    scoringFamily: row.sportLeagueSeason.sportLeague.scoringFamily,
    ...(syncProviderId !== null && { syncProviderId }),
    ...(syncProviderName !== null && { syncProviderName }),
    autoLifecycleEnabled: row.autoLifecycleEnabled,
    ...(row.pricingConfig !== null && { pricingConfig: EventPricingConfigSchema.parse(row.pricingConfig) }),
    ...(row.tierConfig !== null && { tierConfig: EventTierConfigSchema.parse(row.tierConfig) }),
    ...(row.autoReleaseCheckedAt !== null && row.autoReleaseOutcome !== null && {
      autoReleaseCheck: { checkedAt: row.autoReleaseCheckedAt, outcome: row.autoReleaseOutcome, failedChecks: row.autoReleaseFailedChecks },
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The event slot row a round to create is played in, refused when its event does not cover that Season slot. */
function requiredEventSlotId(eventSlotOf: ReadonlyMap<string, { id: string; sportEventId: string }>, round: SportEventRoundCreate): string {
  const eventSlot = eventSlotOf.get(round.seasonSlotId);
  if (eventSlot?.sportEventId !== round.sportEventId) throw new Error(`Sport event ${round.sportEventId} does not cover Season slot ${round.seasonSlotId}.`);
  return eventSlot.id;
}

/** A round with the slot it is played in (#2006). */
const ROUND_SLOT_INCLUDE = { eventSlot: ROUND_EVENT_SLOT_SELECT } as const satisfies Prisma.SportEventRoundInclude;

function toSportEventRound(row: Prisma.SportEventRoundGetPayload<{ include: typeof ROUND_SLOT_INCLUDE }>): SportEventRound {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    roundNumber: row.roundNumber,
    scheduledDate: row.scheduledDate,
    scheduledEndAt: row.scheduledEndAt,
    slot: toRoundSlot(row.eventSlot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The field columns a patch sets; undefined leaves one alone, null clears it. */
function fieldPatch(patch: SportEventParticipantPatch) {
  return {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.ranking !== undefined && { ranking: patch.ranking }),
    ...(patch.oddsToWin !== undefined && { oddsToWin: patch.oddsToWin }),
    ...(patch.seedNumber !== undefined && { seedNumber: patch.seedNumber }),
    ...(patch.isPlayInPlace !== undefined && { isPlayInPlace: patch.isPlayInPlace }),
  };
}

export function toSportEventParticipant(row: Prisma.SportEventParticipantGetPayload<object>): SportEventParticipant {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    participantId: row.participantId,
    status: row.status,
    ranking: row.ranking ?? undefined,
    oddsToWin: row.oddsToWin === null ? undefined : Number(row.oddsToWin),
    seedNumber: row.seedNumber ?? undefined,
    isPlayInPlace: row.isPlayInPlace,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function tierColumns(tier: SportEventTierDefinition) {
  return { tierKey: tier.tierKey, label: tier.label, tierNumber: tier.tierNumber };
}

function toTier(row: Prisma.SportEventTierGetPayload<object>): SportEventTier {
  return {
    id: row.id,
    sportEventId: row.sportEventId,
    ...tierColumns(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toValuation(row: Prisma.SportEventParticipantValuationGetPayload<object>): SportEventParticipantValuation {
  return {
    id: row.id,
    sportEventParticipantId: row.sportEventParticipantId,
    sportEventTierId: row.sportEventTierId,
    tierOrderIndex: row.tierOrderIndex,
    tierAssignedSource: row.tierAssignedSource,
    price: row.price === null ? null : Number(row.price),
    priceAssignedSource: row.priceAssignedSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
