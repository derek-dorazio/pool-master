/**
 * GolfFieldService — a golf tournament's field (SportEventParticipant rows),
 * plans/124 §4.2/§4.7/§4.4a/§5.2.
 *
 * `seedFieldFromLeagueRoster` copies the tournament's league's currently
 * active affiliated participants into the field as a one-time convenience —
 * it does not constrain the field to affiliated golfers afterward.
 * `bulkAddFieldEntries` is the deliberate path for a cross-league invite
 * (a LIV golfer added to a PGA event, etc.): it accepts any `Participant`,
 * with no referential check against `ParticipantLeagueAffiliation` to
 * bypass, because there was never a constraint to begin with.
 *
 * `seedFieldFromProvider` is the field-population path for a tournament
 * linked to a real provider event (§4.4a) — it mirrors, but deliberately
 * does not share code with, `IngestionPersistence.persistParticipants`: that
 * function upserts a `Sport` row for any sport and is a general ingestion
 * primitive, while this one is golf-scoped, fails loudly when no golf
 * `Sport` row exists yet (plans/124 §9 open question 2 — guaranteed by
 * migration seed), and never writes `SportEvent.status` or fires contest
 * side effects — only field/participant matching (§4.10).
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { GolfValuationSource, ParticipantType, Sport, type GolfParticipantInactiveReason } from '@poolmaster/shared/domain';
import type { SportLeagueService } from '../sport-catalog/sport-league-service';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import type { ProviderParticipant } from '../ingestion/core/provider-interface';
import { requireSportRow } from '../sport-catalog/sport-row';
import { deriveSeedNumbersAndOdds } from './golf-seeding-algorithm';

export class GolfFieldError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GolfFieldError';
  }
}

export interface GolfFieldRow {
  sportEventParticipantId: string;
  participantId: string;
  participantName: string;
  shortName: string | null;
  nationality: string | null;
  isActive: boolean;
  inactiveReason: GolfParticipantInactiveReason | null;
  worldRanking: number | null;
  oddsToWin: number | null;
  seedNumber: number | null;
  price: number | null;
  isLeagueRosterMember: boolean;
}

export interface SeedFieldResult {
  added: number;
  skipped: number;
  total: number;
  seedNumbersDerived: number;
  oddsDerived: number;
}

export interface BulkAddFieldResult {
  added: number;
  skipped: number;
  total: number;
}

const FIELD_INCLUDE = {
  include: {
    participant: { select: { name: true, shortName: true, nationality: true } },
    golfValuation: { select: { price: true } },
  },
} as const;

type PrismaFieldRow = {
  id: string;
  participantId: string;
  isActive: boolean;
  inactiveReason: string | null;
  worldRanking: number | null;
  oddsToWin: unknown;
  seedNumber: number | null;
  participant: { name: string; shortName: string | null; nationality: string | null };
  golfValuation: { price: unknown } | null;
};

export class GolfFieldService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sportLeagueService: SportLeagueService,
    private readonly random: () => number = Math.random,
    private readonly providerRegistry: ProviderRegistry = new ProviderRegistry(),
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listField(sportEventId: string): Promise<GolfFieldRow[]> {
    const sportEvent = await this.prisma.sportEvent.findUniqueOrThrow({
      where: { id: sportEventId },
      select: { seasonId: true },
    });
    const sportLeagueId = await this.resolveSportLeagueId(sportEvent.seasonId);
    const rosterParticipantIds = sportLeagueId
      ? new Set((await this.sportLeagueService.getRoster(sportLeagueId)).map((entry) => entry.participantId))
      : new Set<string>();

    const rows = (await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      orderBy: [
        { seedNumber: { sort: 'asc', nulls: 'last' } },
        { participant: { name: 'asc' } },
      ],
      ...FIELD_INCLUDE,
    })) as PrismaFieldRow[];

    return rows.map((row) => toGolfFieldRow(row, rosterParticipantIds));
  }

  /**
   * Idempotent: skips any affiliated participant already in the field.
   * Derives seedNumber/oddsToWin only for the participants being added in
   * this call — existing field rows keep whatever they already have.
   */
  async seedFieldFromLeagueRoster(sportEventId: string): Promise<SeedFieldResult> {
    const sportEvent = await this.prisma.sportEvent.findUniqueOrThrow({
      where: { id: sportEventId },
      select: { seasonId: true },
    });
    if (!sportEvent.seasonId) {
      throw new GolfFieldError(
        `Sport event ${sportEventId} has no season and cannot resolve a league roster to seed from.`,
        'TOURNAMENT_HAS_NO_SEASON',
        409,
      );
    }
    const sportLeagueId = await this.resolveSportLeagueId(sportEvent.seasonId);
    if (!sportLeagueId) {
      throw new GolfFieldError(
        `Sport event ${sportEventId} has no season and cannot resolve a league roster to seed from.`,
        'TOURNAMENT_HAS_NO_SEASON',
        409,
      );
    }

    const roster = await this.sportLeagueService.getRoster(sportLeagueId);
    const activeRoster = roster.filter((entry) => entry.status === 'ACTIVE');

    const existing = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId },
      select: { participantId: true },
    });
    const existingParticipantIds = new Set(existing.map((row) => row.participantId));

    const toAdd = activeRoster.filter((entry) => !existingParticipantIds.has(entry.participantId));
    const seeded = deriveSeedNumbersAndOdds(
      toAdd.map((entry) => ({ participantId: entry.participantId, worldRanking: entry.worldRanking })),
      this.random,
    );

    if (seeded.length > 0) {
      await this.prisma.$transaction(
        seeded.map((entry) =>
          this.prisma.sportEventParticipant.create({
            data: {
              sportEventId,
              participantId: entry.participantId,
              worldRanking: entry.worldRanking,
              seedNumber: entry.seedNumber,
              oddsToWin: entry.oddsToWin,
            },
          }),
        ),
      );
    }

    this.logger?.info({
      sportEventId,
      sportLeagueId,
      added: seeded.length,
      skipped: activeRoster.length - seeded.length,
    }, 'Seeded golf tournament field from league roster');

    return {
      added: seeded.length,
      skipped: activeRoster.length - seeded.length,
      total: activeRoster.length,
      seedNumbersDerived: seeded.length,
      oddsDerived: seeded.length,
    };
  }

  /**
   * Field population for a tournament linked to a real provider event
   * (plans/124 §4.4a). Upsert, not create-only — the same button serves
   * "Load" (first click, empty field) and "Refresh" (later clicks) via
   * `adminRefreshGolfTournamentField`. Per contestant:
   *
   *   1. Resolve or create the global Participant + ParticipantProviderMapping
   *      by exact provider identity — never fuzzy name-matching.
   *   2. worldRanking/oddsToWin follow a priority chain (both present → use
   *      as-is; ranking only → derive odds from ranking-based position;
   *      odds only → derive an implied position from odds ascending; neither
   *      → fall back to this golfer's league-affiliation worldRanking, or no
   *      signal at all). seedNumber always comes from position assignment,
   *      never the provider's own `seed` field, since seed position is
   *      PoolMaster's own draft concept.
   *   3. `price` is never provider-sourced under any branch.
   */
  async seedFieldFromProvider(sportEventId: string): Promise<SeedFieldResult> {
    const sportEvent = await this.prisma.sportEvent.findUniqueOrThrow({
      where: { id: sportEventId },
      select: { providerId: true, externalId: true, seasonId: true },
    });

    const provider = this.providerRegistry.getProviderById(sportEvent.providerId);
    if (!provider) {
      throw new GolfFieldError(`Provider ${sportEvent.providerId} is not registered.`, 'PROVIDER_NOT_FOUND', 404);
    }
    const detail = await provider.getEventDetails(sportEvent.externalId);
    if (!detail) {
      throw new GolfFieldError(
        `Provider returned no event detail for ${sportEvent.externalId}.`,
        'PROVIDER_EVENT_NOT_FOUND',
        404,
      );
    }

    const sportLeagueId = await this.resolveSportLeagueId(sportEvent.seasonId);
    const affiliationRankings = sportLeagueId
      ? new Map((await this.sportLeagueService.getRoster(sportLeagueId)).map((entry) => [entry.participantId, entry.worldRanking]))
      : new Map<string, number | null>();

    const resolved = await Promise.all(
      detail.participants.map(async (participant) => ({
        participant,
        participantId: (await this.resolveOrCreateProviderParticipant(participant)).id,
      })),
    );

    const candidates = resolved.map(({ participant, participantId }) => ({
      participantId,
      isActive: participant.active,
      inactiveReason: participant.inactiveReason ?? null,
      ranking: readIntegerMetadata(participant.metadata, 'ranking'),
      odds: readNumberMetadata(participant.metadata, 'odds'),
    }));

    const rankingPoolCandidates = candidates.filter((c) => !(c.odds !== null && c.ranking === null));
    const oddsPoolCandidates = candidates.filter((c) => c.odds !== null && c.ranking === null);

    const seededByRanking = deriveSeedNumbersAndOdds(
      rankingPoolCandidates.map((c) => ({
        participantId: c.participantId,
        worldRanking: c.ranking ?? affiliationRankings.get(c.participantId) ?? null,
      })),
      this.random,
    );
    const seededByRankingById = new Map(seededByRanking.map((s) => [s.participantId, s]));

    const seededByOdds = [...oddsPoolCandidates].sort((left, right) => (left.odds as number) - (right.odds as number));
    const seedNumberByOddsPoolParticipantId = new Map(seededByOdds.map((c, index) => [c.participantId, index + 1]));

    const existing = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId, participantId: { in: candidates.map((c) => c.participantId) } },
      select: { participantId: true },
    });
    const existingParticipantIds = new Set(existing.map((row) => row.participantId));

    await this.prisma.$transaction(
      candidates.map((candidate) => {
        const rankingResult = seededByRankingById.get(candidate.participantId);

        const worldRanking = rankingResult ? rankingResult.worldRanking : null;
        const oddsToWin = candidate.odds !== null
          ? candidate.odds
          : rankingResult?.oddsToWin ?? null;
        const seedNumber = rankingResult
          ? rankingResult.seedNumber
          : (seedNumberByOddsPoolParticipantId.get(candidate.participantId) as number);

        const data = {
          isActive: candidate.isActive,
          inactiveReason: candidate.inactiveReason,
          worldRanking,
          oddsToWin,
          seedNumber,
        };
        return this.prisma.sportEventParticipant.upsert({
          where: { sportEventId_participantId: { sportEventId, participantId: candidate.participantId } },
          create: { sportEventId, participantId: candidate.participantId, ...data },
          update: data,
        });
      }),
    );

    const added = candidates.filter((c) => !existingParticipantIds.has(c.participantId)).length;
    this.logger?.info({
      sportEventId,
      providerId: sportEvent.providerId,
      total: candidates.length,
      added,
      refreshed: candidates.length - added,
    }, 'Seeded golf tournament field from provider event detail');

    return {
      added,
      skipped: 0,
      total: candidates.length,
      seedNumbersDerived: candidates.length,
      oddsDerived: candidates.filter((c) => c.odds === null).length,
    };
  }

  private async resolveOrCreateProviderParticipant(participant: ProviderParticipant): Promise<{ id: string }> {
    const mapping = await this.prisma.participantProviderMapping.findUnique({
      where: {
        providerId_externalId: { providerId: participant.providerId, externalId: participant.externalId },
      },
    });
    if (mapping) {
      return { id: mapping.participantId };
    }

    const sportRow = await requireSportRow(this.prisma, Sport.GOLF);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.participant.create({
        data: {
          sportId: sportRow.id,
          name: participant.name,
          participantType: ParticipantType.INDIVIDUAL,
          externalId: participant.externalId,
          firstName: participant.firstName ?? null,
          lastName: participant.lastName ?? null,
          nationality: participant.nationality ?? null,
          position: participant.position ?? null,
          teamAffiliation: participant.teamAffiliation ?? null,
          photoUrl: participant.photoUrl ?? null,
          status: participant.active ? 'ACTIVE' : 'INACTIVE',
        },
      });
      await tx.participantProviderMapping.create({
        data: {
          participantId: created.id,
          providerId: participant.providerId,
          externalId: participant.externalId,
          confidence: 'EXACT',
        },
      });
      return { id: created.id };
    });
  }

  /**
   * The cross-league-invite path: accepts any Participant, from any league's
   * roster or none at all. Idempotent — skips a participantId already in
   * the field.
   */
  async bulkAddFieldEntries(sportEventId: string, participantIds: string[]): Promise<BulkAddFieldResult> {
    const existing = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId, participantId: { in: participantIds } },
      select: { participantId: true },
    });
    const existingParticipantIds = new Set(existing.map((row) => row.participantId));
    const toAdd = participantIds.filter((id) => !existingParticipantIds.has(id));

    if (toAdd.length > 0) {
      await this.prisma.$transaction(
        toAdd.map((participantId) =>
          this.prisma.sportEventParticipant.create({
            data: { sportEventId, participantId },
          }),
        ),
      );
    }

    this.logger?.info({
      sportEventId,
      added: toAdd.length,
      skipped: participantIds.length - toAdd.length,
    }, 'Bulk-added golf tournament field entries');

    return {
      added: toAdd.length,
      skipped: participantIds.length - toAdd.length,
      total: participantIds.length,
    };
  }

  /** Bulk row patch — one request per Save on the field grid. */
  async bulkUpdateFieldEntries(
    sportEventId: string,
    entries: Array<{
      sportEventParticipantId: string;
      isActive?: boolean;
      inactiveReason?: GolfParticipantInactiveReason | null;
      worldRanking?: number | null;
      oddsToWin?: number | null;
      seedNumber?: number | null;
      price?: number | null;
    }>,
  ): Promise<GolfFieldRow[]> {
    const owned = await this.prisma.sportEventParticipant.findMany({
      where: { sportEventId, id: { in: entries.map((entry) => entry.sportEventParticipantId) } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((row) => row.id));
    const unowned = entries.filter((entry) => !ownedIds.has(entry.sportEventParticipantId));
    if (unowned.length > 0) {
      throw new GolfFieldError(
        `Field entr${unowned.length === 1 ? 'y' : 'ies'} ${unowned.map((entry) => entry.sportEventParticipantId).join(', ')} not found on sport event ${sportEventId}.`,
        'FIELD_ENTRY_NOT_FOUND',
        404,
      );
    }

    await this.prisma.$transaction(
      entries.map((entry) => {
        const { sportEventParticipantId, price, ...fieldUpdates } = entry;
        return this.prisma.sportEventParticipant.update({
          where: { id: sportEventParticipantId },
          data: {
            ...(fieldUpdates.isActive !== undefined && { isActive: fieldUpdates.isActive }),
            ...(fieldUpdates.inactiveReason !== undefined && { inactiveReason: fieldUpdates.inactiveReason }),
            ...(fieldUpdates.worldRanking !== undefined && { worldRanking: fieldUpdates.worldRanking }),
            ...(fieldUpdates.oddsToWin !== undefined && { oddsToWin: fieldUpdates.oddsToWin }),
            ...(fieldUpdates.seedNumber !== undefined && { seedNumber: fieldUpdates.seedNumber }),
            ...(price !== undefined && {
              golfValuation: {
                upsert: {
                  create: { price, priceAssignedSource: GolfValuationSource.MANUAL },
                  update: { price, priceAssignedSource: GolfValuationSource.MANUAL },
                },
              },
            }),
          },
        });
      }),
    );

    return this.listField(sportEventId);
  }

  async removeFieldEntry(sportEventId: string, sportEventParticipantId: string): Promise<void> {
    const existing = await this.prisma.sportEventParticipant.findUnique({
      where: { id: sportEventParticipantId },
      select: { id: true, sportEventId: true },
    });
    if (!existing || existing.sportEventId !== sportEventId) {
      throw new GolfFieldError(
        `Field entry ${sportEventParticipantId} was not found on sport event ${sportEventId}.`,
        'FIELD_ENTRY_NOT_FOUND',
        404,
      );
    }
    const pickCount = await this.prisma.contestEntryPick.count({
      where: { sportEventParticipantId },
    });
    if (pickCount > 0) {
      throw new GolfFieldError(
        `Field entry ${sportEventParticipantId} has ${pickCount} contest entry pick(s) referencing it and cannot be removed — withdraw instead.`,
        'FIELD_ENTRY_HAS_PICKS',
        409,
      );
    }
    await this.prisma.sportEventParticipant.delete({
      where: { id: sportEventParticipantId },
    });
  }

  private async resolveSportLeagueId(seasonId: string | null): Promise<string | null> {
    if (!seasonId) {
      return null;
    }
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: { sportLeagueId: true },
    });
    return season?.sportLeagueId ?? null;
  }
}

function toGolfFieldRow(row: PrismaFieldRow, rosterParticipantIds: Set<string>): GolfFieldRow {
  return {
    sportEventParticipantId: row.id,
    participantId: row.participantId,
    participantName: row.participant.name,
    shortName: row.participant.shortName,
    nationality: row.participant.nationality,
    isActive: row.isActive,
    inactiveReason: row.inactiveReason as GolfParticipantInactiveReason | null,
    worldRanking: row.worldRanking,
    oddsToWin: row.oddsToWin === null || row.oddsToWin === undefined ? null : Number(row.oddsToWin),
    seedNumber: row.seedNumber,
    price: row.golfValuation?.price == null ? null : Number(row.golfValuation.price),
    isLeagueRosterMember: rosterParticipantIds.has(row.participantId),
  };
}

function readNumberMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readIntegerMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = readNumberMetadata(metadata, key);
  return value === null ? null : Math.trunc(value);
}
