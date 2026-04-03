/**
 * ContestPoolService — pool creation, resolution, lifecycle, and withdrawal handling.
 */

import type {
  ContestMatchupRepository,
  ContestPoolRepository,
  ContestParticipantPoolRepository,
  ParticipantRepository,
} from '@poolmaster/shared/db';
import type {
  ContestMatchup,
  ContestPool,
  ContestPoolConfig,
  ContestParticipantPool,
  Participant,
} from '@poolmaster/shared/domain';
import type { PoolType, SelectionType, Sport } from '@poolmaster/shared/domain';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import type { SportDataProvider, SportEventDetail } from '../ingestion/core/provider-interface';
import type { IngestionPersistence } from '../ingestion/persistence/ingestion-persistence';

// --- Input DTOs ---

export interface CreatePoolInput {
  contestId: string;
  sport: Sport;
  eventId?: string;
  poolType: PoolType;
  config?: ContestPoolConfig;
}

export interface UpdatePoolInput {
  poolType?: PoolType;
  config?: ContestPoolConfig;
  eventId?: string;
}

// --- Service ---

export class ContestPoolService {
  constructor(
    private readonly poolRepo: ContestPoolRepository,
    private readonly poolParticipantRepo: ContestParticipantPoolRepository,
    private readonly participantRepo: ParticipantRepository,
    private readonly contestMatchupRepo: ContestMatchupRepository,
    private readonly prisma: PrismaClient,
    private readonly ingestionPersistence?: IngestionPersistence,
    private readonly providerRegistry?: ProviderRegistry,
  ) {}

  /** Creates a new pool config for a contest. Does not resolve participants yet. */
  async createPool(input: CreatePoolInput): Promise<ContestPool> {
    const existing = await this.poolRepo.findByContest(input.contestId);
    if (existing) {
      throw new PoolAlreadyExistsError(input.contestId);
    }

    return this.poolRepo.create({
      contestId: input.contestId,
      sport: input.sport,
      eventId: input.eventId,
      poolType: input.poolType,
      config: input.config ?? {},
      excludedParticipantIds: [],
      poolLocked: false,
    });
  }

  /** Returns the pool config for a contest, or null. */
  async getPool(contestId: string): Promise<ContestPool | null> {
    return this.poolRepo.findByContest(contestId);
  }

  /** Returns the pool with its resolved participants. */
  async getPoolWithParticipants(
    contestId: string,
  ): Promise<{ pool: ContestPool; participants: ContestParticipantPool[] } | null> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) return null;
    const participants = await this.poolParticipantRepo.findByPool(pool.id);
    return { pool, participants };
  }

  /** Updates pool configuration. Cannot update a locked pool. */
  async updatePool(contestId: string, input: UpdatePoolInput): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);
    return this.poolRepo.update(pool.id, input);
  }

  /**
   * Resolves the pool: generates the participant list based on pool type and config.
   * Clears and re-populates pool participants. Cannot resolve a locked pool.
   */
  async resolvePool(contestId: string): Promise<{ pool: ContestPool; count: number }> {
    const pool = await this.requireUnlockedPool(contestId);
    const participants = await this.resolveParticipants(pool);

    // Clear existing participants and re-populate
    await this.poolParticipantRepo.deleteByPool(pool.id);

    const entries = participants.map((p, index) => ({
      poolId: pool.id,
      contestId: pool.contestId,
      participantId: p.id,
      ranking: index + 1,
      isAvailable: true,
    }));

    const count = await this.poolParticipantRepo.createMany(entries);
    await this.syncContestMatchups(pool);
    return { pool, count };
  }

  /** Refreshes the pool — re-resolves from source. Same as resolve but semantically for updates. */
  async refreshPool(contestId: string): Promise<{ pool: ContestPool; count: number }> {
    return this.resolvePool(contestId);
  }

  /** Locks the pool. No more participants can be added or removed after locking. */
  async lockPool(contestId: string): Promise<ContestPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);
    if (pool.poolLocked) throw new PoolAlreadyLockedError(contestId);

    const participants = await this.poolParticipantRepo.findByPool(pool.id);
    if (participants.length === 0) {
      throw new PoolEmptyError(contestId);
    }

    return this.poolRepo.lock(pool.id);
  }

  /** Excludes a participant from the pool. Cannot exclude from a locked pool. */
  async excludeParticipant(contestId: string, participantId: string): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);

    const excluded = [...pool.excludedParticipantIds];
    if (!excluded.includes(participantId)) {
      excluded.push(participantId);
    }

    return this.poolRepo.update(pool.id, { excludedParticipantIds: excluded });
  }

  /** Removes a participant exclusion. */
  async removeExclusion(contestId: string, participantId: string): Promise<ContestPool> {
    const pool = await this.requireUnlockedPool(contestId);

    const excluded = pool.excludedParticipantIds.filter((id) => id !== participantId);
    return this.poolRepo.update(pool.id, { excludedParticipantIds: excluded });
  }

  /**
   * Marks a participant as unavailable (withdrawal/scratch) in a locked pool.
   * This is the only mutation allowed on a locked pool.
   */
  async markUnavailable(
    contestId: string,
    participantId: string,
    reason: string,
  ): Promise<ContestParticipantPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);

    const participants = await this.poolParticipantRepo.findByContest(contestId);
    const entry = participants.find((p) => p.participantId === participantId);
    if (!entry) throw new ParticipantNotInPoolError(contestId, participantId);

    return this.poolParticipantRepo.update(entry.id, {
      isAvailable: false,
      unavailableReason: reason,
    });
  }

  /** Re-marks a participant as available (e.g., withdrawal reversed). */
  async markAvailable(
    contestId: string,
    participantId: string,
  ): Promise<ContestParticipantPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);

    const participants = await this.poolParticipantRepo.findByContest(contestId);
    const entry = participants.find((p) => p.participantId === participantId);
    if (!entry) throw new ParticipantNotInPoolError(contestId, participantId);

    return this.poolParticipantRepo.update(entry.id, {
      isAvailable: true,
      unavailableReason: undefined,
    });
  }

  // --- Private helpers ---

  private async requireUnlockedPool(contestId: string): Promise<ContestPool> {
    const pool = await this.poolRepo.findByContest(contestId);
    if (!pool) throw new PoolNotFoundError(contestId);
    if (pool.poolLocked) throw new PoolLockedError(contestId);
    return pool;
  }

  private async resolveParticipants(pool: ContestPool): Promise<Participant[]> {
    let participants: Participant[];

    switch (pool.poolType) {
      case 'CUSTOM': {
        const ids = pool.config.customParticipantIds ?? [];
        const all = await Promise.all(ids.map((id) => this.participantRepo.findById(id)));
        participants = all.filter((p): p is Participant => p !== null);
        break;
      }
      case 'FULL_SPORT': {
        // Find the sport ID by looking up participants — sport is stored as string on pool
        const result = await this.participantRepo.search('', {
          sport: pool.sport,
          status: ['ACTIVE'],
        });
        participants = result.participants;
        break;
      }
      case 'RANKING_CUTOFF': {
        const maxRank = pool.config.maxRank ?? 100;
        const result = await this.participantRepo.search('', {
          sport: pool.sport,
          status: ['ACTIVE'],
        }, maxRank);
        participants = result.participants;
        break;
      }
      case 'EVENT_FIELD':
      default: {
        participants = await this.resolveEventFieldParticipants(pool);
        break;
      }
    }

    // Apply exclusions
    const excludedSet = new Set(pool.excludedParticipantIds);
    return participants.filter((p) => !excludedSet.has(p.id));
  }

  private async resolveEventFieldParticipants(pool: ContestPool): Promise<Participant[]> {
    if (!pool.eventId) {
      throw new PoolEventRequiredError(pool.contestId);
    }

    let event = await this.prisma.sportEvent.findUnique({
      where: { id: pool.eventId },
    });
    if (!event) {
      throw new PoolEventNotFoundError(pool.eventId);
    }

    let competitors = extractEventCompetitors(event.metadata);
    let participantExternalIds = competitors
      .map((competitor) => competitor.externalId)
      .filter((value): value is string => Boolean(value));

    if (participantExternalIds.length === 0) {
      const detail = await this.hydrateEventFromProvider(event, pool.sport);
      if (detail?.participants.length) {
        participantExternalIds = detail.participants.map((participant) => participant.externalId);
      }

      event = await this.prisma.sportEvent.findUnique({
        where: { id: pool.eventId },
      });
      if (!event) {
        throw new PoolEventNotFoundError(pool.eventId);
      }

      competitors = extractEventCompetitors(event.metadata);
      if (participantExternalIds.length === 0) {
        participantExternalIds = competitors
          .map((competitor) => competitor.externalId)
          .filter((value): value is string => Boolean(value));
      }
    }

    let participants = participantExternalIds.length > 0
      ? await this.findParticipantsByProviderIds(event.providerId, participantExternalIds)
      : [];

    if (participants.length === 0 && competitors.length > 0) {
      participants = await this.findParticipantsByNames(pool.sport, competitors);
    }

    if (participants.length === 0) {
      throw new PoolEventParticipantsUnavailableError(pool.contestId, pool.eventId);
    }

    return participants;
  }

  private async hydrateEventFromProvider(
    event: {
      id: string;
      providerId: string;
      externalId: string;
      sport: string;
      startDate: Date;
      endDate: Date | null;
      metadata: unknown;
      participantCount: number | null;
      fieldLocked: boolean;
      name: string;
      venue: string | null;
      location: string | null;
      status: string;
      rounds: number | null;
    },
    sport: Sport,
  ): Promise<SportEventDetail | null> {
    const provider = this.providerRegistry?.getProviderById(event.providerId);
    if (!provider) {
      return null;
    }

    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const snapshot = await this.lookupEventSnapshot(provider, sport, event.externalId, event.startDate, event.endDate);
    if (snapshot) {
      await this.prisma.sportEvent.update({
        where: { id: event.id },
        data: {
          metadata: mergeEventMetadata(metadata, snapshot.metadata) as Prisma.InputJsonValue,
          participantCount: snapshot.participantCount ?? event.participantCount,
        },
      });
    }

    const detail = await provider.getEventDetails(event.externalId);
    if (!detail) {
      return null;
    }

    if (detail.participants.length > 0 && this.ingestionPersistence) {
      await this.ingestionPersistence.persistParticipants(detail.participants);
    }

    await this.prisma.sportEvent.update({
      where: { id: event.id },
      data: {
        name: detail.name,
        venue: detail.venue ?? event.venue,
        location: detail.location ?? event.location,
        startDate: detail.startDate,
        endDate: detail.endDate ?? event.endDate,
        status: detail.status,
        rounds: detail.rounds ?? event.rounds,
        participantCount: detail.participantCount ?? (detail.participants.length || event.participantCount),
        fieldLocked: detail.fieldLocked,
        metadata: mergeEventMetadata(metadata, detail.metadata, {
          participantExternalIds: detail.participants.map((participant) => participant.externalId),
          competitors: detail.participants.map((participant, index) => ({
            externalId: participant.externalId,
            name: participant.name,
            seed: readParticipantSeed(participant.metadata) ?? index + 1,
          })),
        }) as Prisma.InputJsonValue,
      },
    });

    return detail;
  }

  private async lookupEventSnapshot(
    provider: SportDataProvider,
    sport: Sport,
    eventExternalId: string,
    startDate: Date,
    endDate: Date | null,
  ) {
    const from = new Date(startDate);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(endDate ?? startDate);
    to.setUTCDate(to.getUTCDate() + 1);

    const events = await provider.getUpcomingEvents(sport, { from, to });
    return events.find((item) => item.externalId === eventExternalId) ?? null;
  }

  private async findParticipantsByProviderIds(
    providerId: string,
    externalIds: string[],
  ): Promise<Participant[]> {
    const mappings = await this.prisma.participantProviderMapping.findMany({
      where: {
        providerId,
        externalId: { in: externalIds },
      },
      include: { participant: true },
    });

    const participantByExternalId = new Map(
      mappings.map((mapping) => [mapping.externalId, mapping.participant]),
    );

    return externalIds
      .map((externalId) => participantByExternalId.get(externalId))
      .filter((participant): participant is NonNullable<typeof participant> => participant !== undefined)
      .map((participant) => ({
        id: participant.id,
        sportId: participant.sportId,
        name: participant.name,
        participantType: participant.participantType as Participant['participantType'],
        externalId: participant.externalId ?? undefined,
        metadata: (participant.metadata ?? {}) as Record<string, unknown>,
        firstName: participant.firstName ?? undefined,
        lastName: participant.lastName ?? undefined,
        shortName: participant.shortName ?? undefined,
        nationality: participant.nationality ?? undefined,
        position: participant.position ?? undefined,
        teamAffiliation: participant.teamAffiliation ?? undefined,
        status: participant.status as Participant['status'],
        injuryStatus: (participant.injuryStatus ?? { status: 'HEALTHY' }) as unknown as Participant['injuryStatus'],
        photoUrl: participant.photoUrl ?? undefined,
        photoLastUpdated: participant.photoLastUpdated ?? undefined,
        externalIds: (participant.externalIds ?? {}) as Record<string, string>,
        createdAt: participant.createdAt,
        updatedAt: participant.updatedAt,
      }));
  }

  private async findParticipantsByNames(
    sport: Sport,
    competitors: EventCompetitor[],
  ): Promise<Participant[]> {
    const names = competitors
      .map((competitor) => competitor.name)
      .filter((value): value is string => Boolean(value));

    if (names.length === 0) {
      return [];
    }

    const rows = await this.prisma.participant.findMany({
      where: {
        sport: { is: { name: sport } },
        OR: names.flatMap((name) => ([
          { name: { equals: name, mode: 'insensitive' } },
          { teamAffiliation: { equals: name, mode: 'insensitive' } },
          { shortName: { equals: name, mode: 'insensitive' } },
        ])),
      },
      orderBy: { name: 'asc' },
    });

    const participantByName = new Map<string, Participant>();
    for (const row of rows) {
      const participant = {
        id: row.id,
        sportId: row.sportId,
        name: row.name,
        participantType: row.participantType as Participant['participantType'],
        externalId: row.externalId ?? undefined,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        shortName: row.shortName ?? undefined,
        nationality: row.nationality ?? undefined,
        position: row.position ?? undefined,
        teamAffiliation: row.teamAffiliation ?? undefined,
        status: row.status as Participant['status'],
        injuryStatus: (row.injuryStatus ?? { status: 'HEALTHY' }) as unknown as Participant['injuryStatus'],
        photoUrl: row.photoUrl ?? undefined,
        photoLastUpdated: row.photoLastUpdated ?? undefined,
        externalIds: (row.externalIds ?? {}) as Record<string, string>,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      participantByName.set(normalizeParticipantLookupKey(row.name), participant);
      if (row.teamAffiliation) {
        participantByName.set(normalizeParticipantLookupKey(row.teamAffiliation), participant);
      }
      if (row.shortName) {
        participantByName.set(normalizeParticipantLookupKey(row.shortName), participant);
      }
    }

    return competitors
      .map((competitor) => participantByName.get(normalizeParticipantLookupKey(competitor.name ?? '')))
      .filter((participant): participant is Participant => participant !== undefined);
  }

  private async syncContestMatchups(pool: ContestPool): Promise<void> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: pool.contestId },
      include: { selectionConfig: true },
    });
    if (!contest) {
      return;
    }

    if (contest.selectionType !== 'PICK_EM' && contest.selectionType !== 'BRACKET_PICK_EM') {
      return;
    }

    const poolParticipants = await this.poolParticipantRepo.findByContest(pool.contestId);
    if (poolParticipants.length === 0) {
      await this.contestMatchupRepo.deleteByContest(pool.contestId);
      return;
    }

    const event = pool.eventId
      ? await this.prisma.sportEvent.findUnique({ where: { id: pool.eventId } })
      : null;

    let matchups: Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>[] = [];
    if (contest.selectionType === 'PICK_EM') {
      matchups = await this.buildPickEmMatchups(pool, contest.lockAt ?? undefined, event, poolParticipants);
    } else if (contest.selectionType === 'BRACKET_PICK_EM') {
      matchups = this.buildBracketMatchups(pool, contest.lockAt ?? undefined, event, poolParticipants);
    }

    if (matchups.length === 0) {
      throw new PoolEventMatchupsUnavailableError(pool.contestId, contest.selectionType as SelectionType);
    }

    await this.contestMatchupRepo.deleteByContest(pool.contestId);
    await this.contestMatchupRepo.createMany(matchups);
  }

  private async buildPickEmMatchups(
    pool: ContestPool,
    contestLockAt: Date | undefined,
    event: {
      id: string;
      providerId: string;
      metadata: unknown;
      startDate: Date;
    } | null,
    poolParticipants: ContestParticipantPool[],
  ): Promise<Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>[]> {
    const participantIds = poolParticipants.map((participant) => participant.participantId);
    const participants = participantIds.length === 0
      ? []
      : await this.prisma.participant.findMany({
        where: { id: { in: participantIds } },
      });
    const participantById = new Map(participants.map((participant) => [participant.id, participant]));

    if (!event) {
      if (poolParticipants.length === 2) {
        return [{
          contestId: pool.contestId,
          eventId: undefined,
          period: 1,
          matchupIndex: 1,
          roundNumber: 1,
          matchNumber: 1,
          label: `${participantById.get(poolParticipants[0].participantId)?.name ?? 'Home'} vs ${participantById.get(poolParticipants[1].participantId)?.name ?? 'Away'}`,
          homeParticipantId: poolParticipants[0].participantId,
          awayParticipantId: poolParticipants[1].participantId,
          startsAt: undefined,
          lockAt: contestLockAt,
          metadata: {},
        }];
      }
      return [];
    }

    const competitors = extractEventCompetitors(event.metadata);
    const idMap = await this.resolveCompetitorParticipantIds(pool.sport, event, competitors, poolParticipants);
    const explicitMatchups = extractEventMatchups(event.metadata);

    if (explicitMatchups.length > 0) {
      return explicitMatchups.map((matchup, index) => ({
        contestId: pool.contestId,
        eventId: event.id,
        period: matchup.period ?? 1,
        matchupIndex: matchup.matchupIndex ?? index + 1,
        roundNumber: matchup.roundNumber,
        matchNumber: matchup.matchNumber ?? index + 1,
        label: matchup.label ?? undefined,
        homeParticipantId: resolveCompetitorParticipantId(matchup.home, idMap),
        awayParticipantId: resolveCompetitorParticipantId(matchup.away, idMap),
        startsAt: matchup.startsAt ?? event.startDate,
        lockAt: matchup.lockAt ?? contestLockAt,
        metadata: matchup.metadata ?? {},
      }));
    }

    if (competitors.length >= 2) {
      const home = competitors.find((competitor) => competitor.homeAway === 'home') ?? competitors[0];
      const away = competitors.find((competitor) => competitor.homeAway === 'away')
        ?? competitors.find((competitor) => competitor !== home)
        ?? null;
      if (!away) {
        return [];
      }

      return [{
        contestId: pool.contestId,
        eventId: event.id,
        period: 1,
        matchupIndex: 1,
        roundNumber: 1,
        matchNumber: 1,
        label: eventLabelFromCompetitors(home, away),
        homeParticipantId: resolveCompetitorParticipantId(home, idMap),
        awayParticipantId: resolveCompetitorParticipantId(away, idMap),
        startsAt: event.startDate,
        lockAt: contestLockAt,
        metadata: {},
      }];
    }

    if (poolParticipants.length === 2) {
      return [{
        contestId: pool.contestId,
        eventId: event.id,
        period: 1,
        matchupIndex: 1,
        roundNumber: 1,
        matchNumber: 1,
        label: `${participantById.get(poolParticipants[0].participantId)?.name ?? 'Home'} vs ${participantById.get(poolParticipants[1].participantId)?.name ?? 'Away'}`,
        homeParticipantId: poolParticipants[0].participantId,
        awayParticipantId: poolParticipants[1].participantId,
        startsAt: event.startDate,
        lockAt: contestLockAt,
        metadata: {},
      }];
    }

    return [];
  }

  private buildBracketMatchups(
    pool: ContestPool,
    contestLockAt: Date | undefined,
    event: {
      id: string;
      startDate: Date;
    } | null,
    poolParticipants: ContestParticipantPool[],
  ): Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>[] {
    const seeded = [...poolParticipants]
      .sort((a, b) => (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER));

    if (seeded.length < 2 || seeded.length % 2 !== 0) {
      return [];
    }

    const totalTeams = seeded.length;
    const matchups: Omit<ContestMatchup, 'id' | 'createdAt' | 'updatedAt'>[] = [];

    for (let index = 0; index < totalTeams / 2; index += 1) {
      const topSeed = seeded[index];
      const bottomSeed = seeded[totalTeams - 1 - index];

      matchups.push({
        contestId: pool.contestId,
        eventId: event?.id,
        period: 1,
        matchupIndex: index + 1,
        roundNumber: 1,
        matchNumber: index + 1,
        label: `Round 1 Match ${index + 1}`,
        homeParticipantId: topSeed.participantId,
        awayParticipantId: bottomSeed.participantId,
        startsAt: event?.startDate,
        lockAt: contestLockAt,
        metadata: {
          topSeed: topSeed.ranking ?? index + 1,
          bottomSeed: bottomSeed.ranking ?? totalTeams - index,
        },
      });
    }

    return matchups;
  }

  private async resolveCompetitorParticipantIds(
    sport: Sport,
    event: { providerId: string; id: string },
    competitors: EventCompetitor[],
    poolParticipants: ContestParticipantPool[],
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const byExternalId = competitors
      .map((competitor) => competitor.externalId)
      .filter((value): value is string => Boolean(value));

    if (byExternalId.length > 0) {
      const participants = await this.findParticipantsByProviderIds(event.providerId, byExternalId);
      const participantByExternalId = new Map<string, string>();
      for (const participant of participants) {
        if (participant.externalId) {
          participantByExternalId.set(participant.externalId, participant.id);
        }
      }
      for (const competitor of competitors) {
        if (competitor.externalId) {
          const participantId = participantByExternalId.get(competitor.externalId);
          if (participantId) {
            resolved.set(competitor.externalId, participantId);
          }
        }
      }
    }

    const unresolvedByName = competitors.filter((competitor) => competitor.name && !resolveCompetitorParticipantId(competitor, resolved));
    if (unresolvedByName.length > 0) {
      const participants = await this.findParticipantsByNames(sport, unresolvedByName);
      const lookup = new Map<string, string>();
      for (const participant of participants) {
        lookup.set(normalizeParticipantLookupKey(participant.name), participant.id);
        if (participant.teamAffiliation) {
          lookup.set(normalizeParticipantLookupKey(participant.teamAffiliation), participant.id);
        }
        if (participant.shortName) {
          lookup.set(normalizeParticipantLookupKey(participant.shortName), participant.id);
        }
      }
      for (const competitor of unresolvedByName) {
        const participantId = lookup.get(normalizeParticipantLookupKey(competitor.name ?? ''));
        if (participantId && competitor.name) {
          resolved.set(`name:${normalizeParticipantLookupKey(competitor.name)}`, participantId);
        }
      }
    }

    for (const poolParticipant of poolParticipants) {
      resolved.set(poolParticipant.participantId, poolParticipant.participantId);
    }

    return resolved;
  }
}

interface EventCompetitor {
  externalId?: string;
  name?: string;
  homeAway?: 'home' | 'away';
  seed?: number;
}

interface EventMatchupDescriptor {
  period?: number;
  matchupIndex?: number;
  roundNumber?: number;
  matchNumber?: number;
  label?: string;
  startsAt?: Date;
  lockAt?: Date;
  home?: EventCompetitor;
  away?: EventCompetitor;
  metadata?: Record<string, unknown>;
}

function extractEventCompetitors(metadata: unknown): EventCompetitor[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const source = metadata as Record<string, unknown>;
  const competitors = Array.isArray(source.competitors) ? source.competitors : [];
  const parsed = competitors
    .filter((competitor): competitor is Record<string, unknown> => Boolean(competitor) && typeof competitor === 'object')
    .map((competitor) => ({
      externalId: readString(competitor.externalId) ?? readString(competitor.id) ?? undefined,
      name: readString(competitor.name) ?? undefined,
      homeAway: readHomeAway(competitor.homeAway),
      seed: readNumber(competitor.seed),
    }));

  if (parsed.length > 0) {
    return parsed;
  }

  const homeTeam = readString(source.homeTeam);
  const awayTeam = readString(source.awayTeam);
  if (homeTeam || awayTeam) {
    const homeAwayCompetitors = [
      { name: homeTeam ?? undefined, homeAway: 'home' as const },
      { name: awayTeam ?? undefined, homeAway: 'away' as const },
    ];
    return homeAwayCompetitors.filter((competitor) => Boolean(competitor.name));
  }

  const participantExternalIds = Array.isArray(source.participantExternalIds)
    ? source.participantExternalIds.filter((value): value is string => typeof value === 'string')
    : [];
  return participantExternalIds.map((externalId) => ({ externalId }));
}

function extractEventMatchups(metadata: unknown): EventMatchupDescriptor[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const source = metadata as Record<string, unknown>;
  if (!Array.isArray(source.matchups)) {
    return [];
  }

  return source.matchups
    .filter((matchup): matchup is Record<string, unknown> => Boolean(matchup) && typeof matchup === 'object')
    .map((matchup, index) => ({
      period: readNumber(matchup.period) ?? 1,
      matchupIndex: readNumber(matchup.matchupIndex) ?? index + 1,
      roundNumber: readNumber(matchup.roundNumber),
      matchNumber: readNumber(matchup.matchNumber) ?? index + 1,
      label: readString(matchup.label) ?? undefined,
      startsAt: readDate(matchup.startsAt),
      lockAt: readDate(matchup.lockAt),
      home: readCompetitorDescriptor(matchup.home),
      away: readCompetitorDescriptor(matchup.away),
      metadata: readRecord(matchup.metadata),
    }));
}

function readCompetitorDescriptor(value: unknown): EventCompetitor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return {
    externalId: readString(source.externalId) ?? readString(source.id) ?? undefined,
    name: readString(source.name) ?? undefined,
    homeAway: readHomeAway(source.homeAway),
    seed: readNumber(source.seed),
  };
}

function mergeEventMetadata(
  ...parts: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  return parts.reduce<Record<string, unknown>>((acc, part) => {
    if (!part) {
      return acc;
    }
    return { ...acc, ...part };
  }, {});
}

function readParticipantSeed(metadata: Record<string, unknown> | undefined): number | undefined {
  if (!metadata) {
    return undefined;
  }
  return readNumber(metadata.seed) ?? readNumber(metadata.rank);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readHomeAway(value: unknown): 'home' | 'away' | undefined {
  return value === 'home' || value === 'away' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function normalizeParticipantLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveCompetitorParticipantId(
  competitor: EventCompetitor | undefined,
  resolvedIds: Map<string, string>,
): string | undefined {
  if (!competitor) {
    return undefined;
  }
  if (competitor.externalId) {
    return resolvedIds.get(competitor.externalId);
  }
  if (competitor.name) {
    return resolvedIds.get(`name:${normalizeParticipantLookupKey(competitor.name)}`);
  }
  return undefined;
}

function eventLabelFromCompetitors(home: EventCompetitor, away: EventCompetitor): string | undefined {
  if (!home.name && !away.name) {
    return undefined;
  }
  return `${home.name ?? 'Home'} vs ${away.name ?? 'Away'}`;
}

// --- Error classes ---

export class PoolNotFoundError extends Error {
  constructor(contestId: string) {
    super(`Pool not found for contest: ${contestId}`);
    this.name = 'PoolNotFoundError';
  }
}

export class PoolAlreadyExistsError extends Error {
  constructor(contestId: string) {
    super(`Pool already exists for contest: ${contestId}`);
    this.name = 'PoolAlreadyExistsError';
  }
}

export class PoolLockedError extends Error {
  constructor(contestId: string) {
    super(`Pool is locked for contest: ${contestId}`);
    this.name = 'PoolLockedError';
  }
}

export class PoolAlreadyLockedError extends Error {
  constructor(contestId: string) {
    super(`Pool is already locked for contest: ${contestId}`);
    this.name = 'PoolAlreadyLockedError';
  }
}

export class PoolEmptyError extends Error {
  constructor(contestId: string) {
    super(`Cannot lock an empty pool for contest: ${contestId}`);
    this.name = 'PoolEmptyError';
  }
}

export class ParticipantNotInPoolError extends Error {
  constructor(contestId: string, participantId: string) {
    super(`Participant ${participantId} not in pool for contest: ${contestId}`);
    this.name = 'ParticipantNotInPoolError';
  }
}

export class PoolEventRequiredError extends Error {
  constructor(contestId: string) {
    super(`EVENT_FIELD pool for contest ${contestId} requires an eventId`);
    this.name = 'PoolEventRequiredError';
  }
}

export class PoolEventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`Sport event not found: ${eventId}`);
    this.name = 'PoolEventNotFoundError';
  }
}

export class PoolEventParticipantsUnavailableError extends Error {
  constructor(contestId: string, eventId: string) {
    super(`Could not resolve participants for contest ${contestId} from event ${eventId}`);
    this.name = 'PoolEventParticipantsUnavailableError';
  }
}

export class PoolEventMatchupsUnavailableError extends Error {
  constructor(contestId: string, selectionType: SelectionType) {
    super(`Could not build ${selectionType} matchups for contest ${contestId}`);
    this.name = 'PoolEventMatchupsUnavailableError';
  }
}
