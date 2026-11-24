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
import { MANUAL_ADMIN_PROVIDER_ID, providerSourceIdOf, SportEventSyncScope, type Sport } from '@poolmaster/shared/domain';
import { SELECTED_PROVIDER_MAPPING_INCLUDE, toSelectedProviderMapping } from '../../adapters/prisma-sport-catalog-repositories';
import { SPORT_EVENT_SPORT_SELECT, sportOfEvent } from '../../adapters/sport-of';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import {
  ProviderLeagueRefusedError,
  type DateRange,
  type SportEvent as ProviderCatalogSportEvent,
} from '../ingestion/core/provider-interface';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import { forgettingReads, ReadMemoKey } from '../../core/request-read-memo';

export class EventScoreSourceError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
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
 * The provider league codes a sport league is mapped to on this provider (#1997), selected for its
 * sync or not, so a mapped league that is not synced yet still browses its own provider league and
 * not the whole sport's feed. Empty for a league with no mapping to this provider.
 */
async function mappedProviderLeagueCodes(prisma: PrismaClient, sportLeagueId: string, providerId: string): Promise<string[]> {
  const mappings = await prisma.sportLeagueProviderMapping.findMany({
    where: { sportLeagueId },
    select: { providerLeague: { select: { code: true, provider: { select: { code: true } } } } },
    orderBy: { providerLeague: { code: 'asc' } },
  });
  return mappings
    .filter((mapping) => providerSourceIdOf(mapping.providerLeague.provider.code) === providerId)
    .map((mapping) => mapping.providerLeague.code);
}

/** The browse's ask of its provider: the one provider league, when the league maps exactly one. */
function askedForAlone(codes: ReadonlySet<string>): { providerLeagueCode: string } | undefined {
  if (codes.size !== 1) return undefined;
  const [code] = codes;
  return { providerLeagueCode: code };
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

    // A league with no mapping to this provider names no provider league to keep. One mapped
    // league is asked for alone; several are read together and kept by their codes.
    const providerLeagueCodes = options.sportLeagueId
      ? new Set(await mappedProviderLeagueCodes(this.prisma, options.sportLeagueId, providerId))
      : new Set<string>();
    const events = await provider.getUpcomingEvents(sport, dateRange, askedForAlone(providerLeagueCodes));
    const search = options.search?.trim().toLowerCase() || null;

    return events
      .filter((event) => providerLeagueCodes.size === 0
        || (event.providerLeagueCode !== undefined && providerLeagueCodes.has(event.providerLeagueCode)))
      .filter((event) => !search || event.name.toLowerCase().includes(search));
  }

  /**
   * #385 — a sport league's slate for one year, for the bulk import and the league's events sync:
   * the events of the provider league its selected provider mapping names (#1997), by the code
   * the provider stamps on each, never by a name. The year is the event's UTC start date. The
   * provider is asked for that league alone, and a refusal of it by the provider's plan is a
   * `PROVIDER_LEAGUE_REFUSED` error (#1797). 422 SPORT_LEAGUE_NOT_SYNCED when the league has no
   * selected mapping to this provider.
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
      include: { sport: true, ...SELECTED_PROVIDER_MAPPING_INCLUDE },
    });
    if (!sportLeague) {
      throw new EventScoreSourceError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const mapping = toSelectedProviderMapping(sportLeague.selectedProviderMapping);
    if (mapping === null || mapping.providerId !== providerId) {
      throw new EventScoreSourceError(
        `${sportLeague.name} is not synced from provider ${providerId}, so none of its leagues is ${sportLeague.name}'s.`,
        'SPORT_LEAGUE_NOT_SYNCED',
        422,
      );
    }
    const providerLeagueCode = mapping.providerLeagueCode;

    const events = await provider.getUpcomingEvents(sportLeague.sport.sport, {
      from: new Date(Date.UTC(eventYear, 0, 1)),
      to: new Date(Date.UTC(eventYear + 1, 0, 1) - 1),
    }, { providerLeagueCode }).catch((error: unknown) => {
      // #1797 — the provider's plan leaves this league out: say so, not "something went wrong".
      if (error instanceof ProviderLeagueRefusedError) {
        throw new EventScoreSourceError(error.message, 'PROVIDER_LEAGUE_REFUSED', 422);
      }
      throw error;
    });
    return events
      .filter((event) => event.providerLeagueCode === providerLeagueCode)
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
    const existing = await this.requireSportEvent(sportEventId);
    // A link no provider could ever send scores for is refused rather than stored.
    const provider = this.providerRegistry.getProviderById(input.providerId);
    if (!provider) {
      throw new EventScoreSourceError(`Provider ${input.providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }
    const sport = sportOfEvent(existing);
    if (!provider.sportsCovered.includes(sport)) {
      throw new EventScoreSourceError(
        `Provider ${input.providerId} does not cover ${sport}, the sport of sport event ${sportEventId}.`,
        'PROVIDER_SPORT_MISMATCH',
        422,
      );
    }

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

    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: input.providerId,
        externalId: input.externalId,
        syncScope: SportEventSyncScope.SCORES_ONLY,
      },
    }));

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

    await forgettingReads(ReadMemoKey.sportEvent, () => this.prisma.sportEvent.update({
      where: { id: sportEventId },
      data: {
        providerId: MANUAL_ADMIN_PROVIDER_ID,
        externalId: `manual-${randomUUID()}`,
        syncScope: SportEventSyncScope.NONE,
      },
    }));

    this.logger?.info({ sportEventId }, 'Unlinked sport event score source');
  }

  private async requireSportEvent(sportEventId: string) {
    const existing = await this.prisma.sportEvent.findUnique({ where: { id: sportEventId }, include: SPORT_EVENT_SPORT_SELECT });
    if (!existing) {
      throw new EventScoreSourceError(`Sport event ${sportEventId} was not found.`, 'EVENT_NOT_FOUND', 404);
    }
    return existing;
  }
}
