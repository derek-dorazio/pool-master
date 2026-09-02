/**
 * GolfTournamentService — admin authoring for golf tournaments (plans/124
 * §4.3/§4.3a/§5.2). `adminCreateGolfTournament` is (with
 * `adminCreateGolfTournamentFromProviderEvent`, a later slice) one of the
 * only two places a `SportEvent` row is ever created — every manual
 * tournament gets `providerId = MANUAL_ADMIN_PROVIDER_ID`, a
 * server-generated `externalId`, `status = SCHEDULED`, and `syncScope =
 * NONE`, then seeds its round schedule (`ensureSportEventRounds`) and
 * default tiers (`ensureDefaultGolfTiers`) — the same one-code-path
 * guarantee `event-lifecycle-service.ts` established for status transitions.
 *
 * `seasonId` is validated against `Sport.GOLF` via
 * `SeasonService.assertSeasonBelongsToSport` (422 SEASON_SPORT_MISMATCH) —
 * ordinary foreign-key-target validation, not two independently-true facts
 * that could drift (plans/124 §4.3).
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  MANUAL_ADMIN_PROVIDER_ID,
  SPORT_EVENT_STATUS_TRANSITIONS,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
} from '@poolmaster/shared/domain';
import type { SeasonService } from '../sport-catalog/season-service';
import type { GolfRoundScheduleService } from './golf-round-schedule-service';
import type { GolfTierService } from './golf-tier-service';
import { deriveGolfTournamentRounds } from './golf-seeding-algorithm';
import { resolveEventTiming, resolveTimingPolicyForSport } from '../events/operational-timing';

export class GolfTournamentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GolfTournamentError';
  }
}

export interface GolfTournamentRow {
  id: string;
  providerId: string;
  externalId: string;
  name: string;
  venue: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  status: SportEventStatus;
  rounds: number | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  seasonId: string | null;
  leagueEventId: string | null;
  syncScope: string;
  autoLifecycleEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  fieldCount: number;
  tierCount: number;
  contestCount: number;
}

const TOURNAMENT_INCLUDE = {
  include: {
    _count: {
      select: {
        sportEventParticipants: true,
        golfTiers: true,
        contests: true,
      },
    },
  },
} as const;

type PrismaSportEventWithCounts = {
  id: string;
  providerId: string;
  externalId: string;
  name: string;
  venue: string | null;
  location: string | null;
  startDate: Date;
  endDate: Date | null;
  status: string;
  rounds: number | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  fieldLocked: boolean;
  seasonId: string | null;
  leagueEventId: string | null;
  syncScope: string;
  autoLifecycleEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { sportEventParticipants: number; golfTiers: number; contests: number };
};

export class GolfTournamentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly seasonService: SeasonService,
    private readonly golfRoundScheduleService: GolfRoundScheduleService,
    private readonly golfTierService: GolfTierService,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  async listTournaments(options: { status?: SportEventStatus; search?: string } = {}): Promise<GolfTournamentRow[]> {
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        sport: Sport.GOLF,
        ...(options.status ? { status: options.status } : {}),
        ...(options.search ? { name: { contains: options.search, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ startDate: 'desc' }],
      ...TOURNAMENT_INCLUDE,
    });
    return (rows as PrismaSportEventWithCounts[]).map(toGolfTournamentRow);
  }

  async createTournament(input: {
    name: string;
    venue?: string;
    location?: string;
    startDate: Date;
    endDate?: Date;
    rounds?: number;
    releaseAt: Date;
    fieldLocksAt: Date;
    seasonId: string;
    autoLifecycleEnabled?: boolean;
  }): Promise<GolfTournamentRow> {
    const season = await this.seasonService.assertSeasonBelongsToSport(input.seasonId, Sport.GOLF);
    const rounds = input.rounds ?? 4;

    const leagueEvent = await this.prisma.leagueEvent.upsert({
      where: { sportLeagueId_name: { sportLeagueId: season.sportLeagueId, name: input.name } },
      create: { sportLeagueId: season.sportLeagueId, name: input.name },
      update: {},
    });

    const created = await this.prisma.sportEvent.create({
      data: {
        externalId: `manual-${randomUUID()}`,
        providerId: MANUAL_ADMIN_PROVIDER_ID,
        sport: Sport.GOLF,
        name: input.name,
        venue: input.venue ?? null,
        location: input.location ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: SportEventStatus.SCHEDULED,
        rounds,
        releaseAt: input.releaseAt,
        fieldLocksAt: input.fieldLocksAt,
        seasonId: season.id,
        leagueEventId: leagueEvent.id,
        syncScope: 'NONE',
        autoLifecycleEnabled: input.autoLifecycleEnabled ?? true,
      },
      ...TOURNAMENT_INCLUDE,
    });

    await this.golfRoundScheduleService.ensureSportEventRounds({
      sportEventId: created.id,
      rounds,
      startDate: input.startDate,
    });
    await this.golfTierService.ensureDefaultGolfTiers(created.id);

    this.logger?.info({
      sportEventId: created.id,
      seasonId: season.id,
      leagueEventId: leagueEvent.id,
      rounds,
    }, 'Created manual golf tournament');

    return toGolfTournamentRow(created as PrismaSportEventWithCounts);
  }

  /**
   * The second, equally first-class creation entry point (plans/124 §4.4a):
   * a tournament created directly from a browsed provider event, pre-linked
   * (syncScope=SCORES_ONLY) rather than starting at the manual-admin
   * placeholder identity and requiring a separate link step. Does not touch
   * the field — that is `adminRefreshGolfTournamentField`'s job, a
   * separate, explicit action.
   */
  async createTournamentFromProviderEvent(input: {
    seasonId: string;
    providerId: string;
    externalId: string;
    name: string;
    venue: string | null;
    startDate: Date;
    endDate: Date | null;
    rounds?: number;
  }): Promise<GolfTournamentRow> {
    const season = await this.seasonService.assertSeasonBelongsToSport(input.seasonId, Sport.GOLF);

    const conflict = await this.prisma.sportEvent.findFirst({
      where: { providerId: input.providerId, externalId: input.externalId },
    });
    if (conflict) {
      throw new GolfTournamentError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }

    const leagueEvent = await this.prisma.leagueEvent.upsert({
      where: { sportLeagueId_name: { sportLeagueId: season.sportLeagueId, name: input.name } },
      create: { sportLeagueId: season.sportLeagueId, name: input.name },
      update: {},
    });

    const timingPolicy = await resolveTimingPolicyForSport(this.prisma, Sport.GOLF, {});
    const timing = resolveEventTiming(
      { sport: Sport.GOLF, startDate: input.startDate, metadata: {} },
      timingPolicy,
    );
    // deriveGolfTournamentRounds's 4-round, endDate-aware default only
    // applies when the admin hasn't overridden the round count — an
    // explicit rounds count falls back to the same plain sequential-daily
    // schedule manual creation uses, so SportEvent.rounds always matches
    // the SportEventRound rows actually created.
    const rounds = input.rounds ?? deriveGolfTournamentRounds(input.startDate, input.endDate).length;

    const created = await this.prisma.sportEvent.create({
      data: {
        externalId: input.externalId,
        providerId: input.providerId,
        sport: Sport.GOLF,
        name: input.name,
        venue: input.venue,
        location: null,
        startDate: input.startDate,
        endDate: input.endDate,
        status: SportEventStatus.SCHEDULED,
        rounds,
        releaseAt: timing.releaseAt,
        fieldLocksAt: timing.fieldLocksAt,
        seasonId: season.id,
        leagueEventId: leagueEvent.id,
        syncScope: SportEventSyncScope.SCORES_ONLY,
        autoLifecycleEnabled: true,
      },
      ...TOURNAMENT_INCLUDE,
    });

    if (input.rounds === undefined) {
      const derivedRounds = deriveGolfTournamentRounds(input.startDate, input.endDate);
      await this.golfRoundScheduleService.createSportEventRoundsFromSchedule(created.id, derivedRounds);
    } else {
      await this.golfRoundScheduleService.ensureSportEventRounds({
        sportEventId: created.id,
        rounds,
        startDate: input.startDate,
      });
    }
    await this.golfTierService.ensureDefaultGolfTiers(created.id);

    this.logger?.info({
      sportEventId: created.id,
      seasonId: season.id,
      leagueEventId: leagueEvent.id,
      providerId: input.providerId,
      externalId: input.externalId,
      rounds,
    }, 'Created golf tournament from provider event');

    return toGolfTournamentRow(created as PrismaSportEventWithCounts);
  }

  async getTournament(eventId: string): Promise<GolfTournamentRow | null> {
    const row = await this.prisma.sportEvent.findUnique({
      where: { id: eventId },
      ...TOURNAMENT_INCLUDE,
    });
    return row ? toGolfTournamentRow(row as PrismaSportEventWithCounts) : null;
  }

  async updateTournament(
    eventId: string,
    updates: {
      name?: string;
      venue?: string | null;
      location?: string | null;
      startDate?: Date;
      endDate?: Date | null;
      rounds?: number;
      releaseAt?: Date;
      fieldLocksAt?: Date;
      autoLifecycleEnabled?: boolean;
    },
  ): Promise<GolfTournamentRow> {
    const existing = await this.prisma.sportEvent.findUnique({ where: { id: eventId } });
    if (!existing) {
      throw new GolfTournamentError(`Golf tournament ${eventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    if (existing.syncScope === 'FULL') {
      throw new GolfTournamentError(
        `Sport event ${eventId} is provider-owned and cannot be edited through admin golf routes.`,
        'EVENT_NOT_ADMIN_MANAGED',
        409,
      );
    }

    const updated = await this.prisma.sportEvent.update({
      where: { id: eventId },
      data: {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.venue !== undefined && { venue: updates.venue }),
        ...(updates.location !== undefined && { location: updates.location }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.rounds !== undefined && { rounds: updates.rounds }),
        ...(updates.releaseAt !== undefined && { releaseAt: updates.releaseAt }),
        ...(updates.fieldLocksAt !== undefined && { fieldLocksAt: updates.fieldLocksAt }),
        ...(updates.autoLifecycleEnabled !== undefined && { autoLifecycleEnabled: updates.autoLifecycleEnabled }),
      },
      ...TOURNAMENT_INCLUDE,
    });
    return toGolfTournamentRow(updated as PrismaSportEventWithCounts);
  }

  async deleteTournament(eventId: string): Promise<void> {
    const existing = await this.prisma.sportEvent.findUnique({ where: { id: eventId } });
    if (!existing) {
      throw new GolfTournamentError(`Golf tournament ${eventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    const contestCount = await this.prisma.contest.count({ where: { sportEventId: eventId } });
    if (contestCount > 0) {
      throw new GolfTournamentError(
        `Sport event ${eventId} has ${contestCount} contest(s) referencing it and cannot be deleted.`,
        'EVENT_HAS_CONTESTS',
        409,
      );
    }
    await this.prisma.sportEvent.delete({ where: { id: eventId } });
  }

  /** The declared transition map's row for `status` — used to build the workflow block. */
  getAllowedTransitions(status: SportEventStatus): SportEventStatus[] {
    return [...SPORT_EVENT_STATUS_TRANSITIONS[status]];
  }
}

function toGolfTournamentRow(row: PrismaSportEventWithCounts): GolfTournamentRow {
  return {
    id: row.id,
    providerId: row.providerId,
    externalId: row.externalId,
    name: row.name,
    venue: row.venue,
    location: row.location,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as SportEventStatus,
    rounds: row.rounds,
    releaseAt: row.releaseAt,
    fieldLocksAt: row.fieldLocksAt,
    fieldLocked: row.fieldLocked,
    seasonId: row.seasonId,
    leagueEventId: row.leagueEventId,
    syncScope: row.syncScope,
    autoLifecycleEnabled: row.autoLifecycleEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    fieldCount: row._count.sportEventParticipants,
    tierCount: row._count.golfTiers,
    contestCount: row._count.contests,
  };
}
