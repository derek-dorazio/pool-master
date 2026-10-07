/**
 * EventScoreSourceService — the cross-sport half of "browse a provider's
 * catalog and link it to an admin-authored SportEvent for live scoring"
 * (plans/124 §3.4/§4.4). Lives beside event-lifecycle-service.ts, not in
 * modules/golf/, because nothing about it is golf-shaped: browsing a
 * provider's upcoming events and linking/unlinking a score source is exactly
 * as true for a future admin-created NBA game as it is for a golf
 * tournament. Golf's admin routes call it the same way they call
 * event-lifecycle-service.ts for status transitions.
 *
 * `listCandidateEvents` is deliberately a plain filtered list, not a scored
 * match — an earlier draft's `findCandidateMatches` similarity-scoring
 * design was deleted per explicit direction, not simplified (plans/124
 * §4.4). It is also the single place that resolves "which provider is
 * registered for this id" for every read-only catalog lookup the admin-golf
 * module needs, so there is exactly one failure mode when a provider isn't
 * registered.
 */

import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { MANUAL_ADMIN_PROVIDER_ID, SportEventSyncScope, type Sport } from '@poolmaster/shared/domain';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import {
  supportsLiveSimulation,
  type DateRange,
  type LiveSimulationOptions,
  type LiveSimulationStatus,
  type SportEvent as ProviderCatalogSportEvent,
} from '../ingestion/core/provider-interface';

export class EventScoreSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'EventScoreSourceError';
  }
}

export interface ProviderEventDetailSummary {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
}

/** Open ends for a browse given only one bound. */
const EARLIEST_DATE = new Date(-8.64e15);
const LATEST_DATE = new Date(8.64e15);

/**
 * #385 — whether a provider event belongs to the tour a sport league's matchKeyword names:
 * its `metadata.tour` equals the keyword, ignoring case and surrounding space. Exact, so
 * "PGA TOUR" never matches "LPGA Tour".
 */
function isTourEvent(event: ProviderCatalogSportEvent, keyword: string): boolean {
  const tour = event.metadata.tour;
  return typeof tour === 'string' && tour.trim().toLowerCase() === keyword.trim().toLowerCase();
}

export class EventScoreSourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistry: ProviderRegistry = new ProviderRegistry(),
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Calls `provider.getUpcomingEvents` live — no dependency on any persisted
   * SportEvent row or on schedule/field sync being enabled. Serves both the
   * tournament-creation browse mode and the score-source linking picker
   * (plans/124 §4.4/§4.4a) — the only candidate-lookup operation.
   */
  async listCandidateEvents(
    providerId: string,
    sport: Sport,
    options: { sportLeagueId?: string; from?: Date; to?: Date; search?: string } = {},
  ): Promise<ProviderCatalogSportEvent[]> {
    const provider = this.providerRegistry.getProviderById(providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }

    // #402 — no window around today: without from/to the browse covers every event the
    // provider has, filtered below by league and search only.
    const dateRange: DateRange | undefined = options.from || options.to
      ? { from: options.from ?? EARLIEST_DATE, to: options.to ?? LATEST_DATE }
      : undefined;

    const events = await provider.getUpcomingEvents(sport, dateRange);

    const matchKeyword = options.sportLeagueId
      ? (await this.prisma.sportLeague.findUnique({ where: { id: options.sportLeagueId } }))?.matchKeyword ?? null
      : null;
    const search = options.search?.trim().toLowerCase() || null;

    // #385 — a league's keyword is either the provider's tour name or a name substring.
    return events
      .filter((event) => !matchKeyword
        || isTourEvent(event, matchKeyword)
        || event.name.toLowerCase().includes(matchKeyword.toLowerCase()))
      .filter((event) => !search || event.name.toLowerCase().includes(search));
  }

  /**
   * #385 — a tour's slate for one year, for the bulk import. A provider event belongs to the
   * tour when its `metadata.tour` equals the sport league's matchKeyword, ignoring case, so
   * "PGA TOUR" never picks up "LPGA Tour" the way a name substring would. The year is the
   * event's UTC start date.
   */
  async listTourEventsForYear(
    providerId: string,
    sportLeagueId: string,
    eventYear: number,
  ): Promise<Array<ProviderEventDetailSummary & { externalId: string }>> {
    const provider = this.providerRegistry.getProviderById(providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }
    const sportLeague = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      include: { sport: true },
    });
    if (!sportLeague) {
      throw new EventScoreSourceError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const tour = sportLeague.matchKeyword?.trim();
    if (!tour) {
      throw new EventScoreSourceError(
        `${sportLeague.name} has no match keyword, so no provider tour can be matched to it.`,
        'SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD',
        422,
      );
    }

    const events = await provider.getUpcomingEvents(sportLeague.sport.name as Sport, {
      from: new Date(Date.UTC(eventYear, 0, 1)),
      to: new Date(Date.UTC(eventYear + 1, 0, 1) - 1),
    });
    return events
      .filter((event) => isTourEvent(event, tour))
      .map((event) => ({
        externalId: event.externalId,
        name: event.name,
        venue: event.venue ?? null,
        startDate: event.startDate,
        endDate: event.endDate ?? null,
      }));
  }

  /**
   * The single place `createEventFromProviderEvent` (plans/124
   * §4.4a) resolves a browsed provider event's name/venue/dates to prefill a
   * new tournament — the same provider-registry resolution
   * `listCandidateEvents` already uses, not a direct `providerRegistry` call
   * from `modules/golf/`.
   */
  async getProviderEventDetail(
    providerId: string,
    externalId: string,
  ): Promise<ProviderEventDetailSummary> {
    const provider = this.providerRegistry.getProviderById(providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }

    const detail = await provider.getEventDetails(externalId);
    if (!detail) {
      throw new EventScoreSourceError(
        `Provider ${providerId} returned no event detail for ${externalId}.`,
        'PROVIDER_EVENT_NOT_FOUND',
        404,
      );
    }

    return {
      name: detail.name,
      venue: detail.venue ?? null,
      startDate: detail.startDate,
      endDate: detail.endDate ?? null,
    };
  }

  /**
   * Sets providerId/externalId/syncScope=SCORES_ONLY in one write. Does not,
   * by itself, import the provider's field or odds — a tournament that
   * already has an admin/season-authored field keeps it untouched
   * (plans/124 §4.4).
   */
  async linkScoreSource(
    sportEventId: string,
    input: { providerId: string; externalId: string },
  ): Promise<void> {
    await this.requireSportEvent(sportEventId);

    const conflict = await this.prisma.sportEvent.findFirst({
      where: {
        providerId: input.providerId,
        externalId: input.externalId,
        NOT: { id: sportEventId },
      },
    });
    if (conflict) {
      throw new EventScoreSourceError(
        `Another sport event is already linked to ${input.providerId}/${input.externalId}.`,
        'EXTERNAL_EVENT_ALREADY_LINKED',
        409,
      );
    }

    await this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: input.providerId,
        externalId: input.externalId,
        syncScope: SportEventSyncScope.SCORES_ONLY,
      },
    });

    this.logger?.info(
      { sportEventId, providerId: input.providerId, externalId: input.externalId },
      'Linked sport event score source',
    );
  }

  /**
   * Reverts to the manual-admin placeholder identity and syncScope=NONE.
   * Already-synced score rows are left as-is — the tournament simply stops
   * receiving further automatic score updates (plans/124 §4.4).
   */
  async unlinkScoreSource(sportEventId: string): Promise<void> {
    await this.requireSportEvent(sportEventId);

    await this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: MANUAL_ADMIN_PROVIDER_ID,
        externalId: `manual-${randomUUID()}`,
        syncScope: SportEventSyncScope.NONE,
      },
    });

    this.logger?.info({ sportEventId }, 'Unlinked sport event score source');
  }

  /**
   * Asks the event's linked score source to play its live scoring forward on the
   * provider's own clock (#382), so a live contest's leaderboard can be exercised without a
   * real tournament in progress. Scores still arrive through the normal live-score sync.
   * 409 EVENT_NOT_LINKED for an unlinked event; 422 LIVE_SIMULATION_UNSUPPORTED when the
   * provider has no simulation (every real provider).
   */
  async startLiveSimulation(sportEventId: string, options: LiveSimulationOptions): Promise<LiveSimulationStatus> {
    const { existing, provider } = await this.requireSimulatingProvider(sportEventId);
    const status = await provider.startLiveSimulation(existing.externalId, options);
    if (!status) {
      throw new EventScoreSourceError(
        `Provider ${existing.providerId} has no event ${existing.externalId}.`,
        'PROVIDER_EVENT_NOT_FOUND',
        404,
      );
    }

    this.logger?.info(
      {
        sportEventId,
        providerId: existing.providerId,
        externalId: existing.externalId,
        startsAt: status.startsAt.toISOString(),
        minutesPerRound: status.minutesPerRound,
      },
      'Started provider live simulation',
    );
    return status;
  }

  /**
   * The simulation the event's score source is running now, so Tournament Home can show its
   * round as it advances. 404 LIVE_SIMULATION_NOT_RUNNING when none is (never started, or
   * the mock restarted); the same 409/422 as `startLiveSimulation` otherwise.
   */
  async getLiveSimulation(sportEventId: string): Promise<LiveSimulationStatus> {
    const { existing, provider } = await this.requireSimulatingProvider(sportEventId);
    const status = await provider.getLiveSimulation(existing.externalId);
    if (!status) {
      throw new EventScoreSourceError(
        `No live simulation is running for sport event ${sportEventId}.`,
        'LIVE_SIMULATION_NOT_RUNNING',
        404,
      );
    }
    return status;
  }

  private async requireSimulatingProvider(sportEventId: string) {
    const existing = await this.requireSportEvent(sportEventId);
    if (existing.syncScope === SportEventSyncScope.NONE) {
      throw new EventScoreSourceError(`Sport event ${sportEventId} is not linked to a provider.`, 'EVENT_NOT_LINKED', 409);
    }

    const provider = this.providerRegistry.getProviderById(existing.providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${existing.providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }
    if (!supportsLiveSimulation(provider)) {
      throw new EventScoreSourceError(
        `Provider ${existing.providerId} cannot simulate live scoring.`,
        'LIVE_SIMULATION_UNSUPPORTED',
        422,
      );
    }
    // The simulation plays golf rounds only; a simulating provider may cover other sports too.
    if (existing.sport !== 'GOLF') {
      throw new EventScoreSourceError(
        `Live scoring can only be simulated for golf events, not ${existing.sport}.`,
        'LIVE_SIMULATION_UNSUPPORTED',
        422,
      );
    }
    return { existing, provider };
  }

  private async requireSportEvent(sportEventId: string) {
    const existing = await this.prisma.sportEvent.findUnique({ where: { id: sportEventId } });
    if (!existing) {
      throw new EventScoreSourceError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return existing;
  }
}
