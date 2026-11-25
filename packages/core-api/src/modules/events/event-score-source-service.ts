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
  type ProviderEventListOptions,
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
 * The provider leagues a sport league is mapped to on this provider (#1997), so a browse for one
 * league reads that league alone rather than the whole sport's feed; each with its Seasons' spans
 * and the provider’s own id for each (#2003), earliest first. Empty for a league with no
 * mapping to this provider.
 */
async function mappedProviderLeagues(prisma: PrismaClient, sportLeagueId: string, providerId: string): Promise<MappedProviderLeague[]> {
  const mappings = await prisma.sportLeagueProviderMapping.findMany({
    where: { sportLeagueId },
    select: {
      providerLeague: { select: { code: true, provider: { select: { code: true } } } },
      seasonMappings: {
        select: { providerSeasonId: true, season: { select: { startsAt: true, endsAt: true, currentOf: { select: { id: true } } } } },
        orderBy: [{ season: { startsAt: 'asc' } }, { id: 'asc' }],
      },
    },
    orderBy: { providerLeague: { code: 'asc' } },
  });
  return mappings
    .filter((mapping) => providerSourceIdOf(mapping.providerLeague.provider.code) === providerId)
    .map((mapping) => ({
      code: mapping.providerLeague.code,
      seasons: mapping.seasonMappings.map(({ providerSeasonId, season }) => ({
        providerSeasonId,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
        isCurrent: season.currentOf !== null,
      })),
    }));
}

interface MappedProviderLeague {
  code: string;
  seasons: Array<{ providerSeasonId: string; startsAt: Date; endsAt: Date; isCurrent: boolean }>;
}

/**
 * The browse's asks of its provider. A league that maps exactly one provider league is asked for
 * alone, by the provider's own ids for its Seasons (#2003): with no date range its current Season,
 * so the browse lists the Season being played, and with one every Season whose span meets the
 * range, so no reader turns a date into a season number. A league whose Seasons carry none of
 * the provider's ids yet (one made through the API) is asked for alone, and the provider reads its
 * own default. Several mapped leagues, or none, are one ask of the whole sport.
 */
function browseAsks(leagues: readonly MappedProviderLeague[], dateRange: DateRange | undefined): Array<ProviderEventListOptions | undefined> {
  if (leagues.length !== 1) return [undefined];
  const [league] = leagues;
  if (league.seasons.length === 0) return [{ providerLeagueCode: league.code }];
  const seasons = dateRange === undefined
    ? league.seasons.filter((season) => season.isCurrent)
    : league.seasons.filter((season) => season.startsAt <= dateRange.to && season.endsAt >= dateRange.from);
  return seasons.map((season) => ({ providerLeagueCode: league.code, providerSeasonId: season.providerSeasonId }));
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
    const mapped = options.sportLeagueId ? await mappedProviderLeagues(this.prisma, options.sportLeagueId, providerId) : [];
    const providerLeagueCodes = new Set(mapped.map((league) => league.code));
    const events = (await Promise.all(browseAsks(mapped, dateRange).map((ask) => provider.getUpcomingEvents(sport, dateRange, ask)))).flat();
    const search = options.search?.trim().toLowerCase() || null;

    return events
      // A Season read whole may run past the range at either end.
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to))
      .filter((event) => providerLeagueCodes.size === 0
        || (event.providerLeagueCode !== undefined && providerLeagueCodes.has(event.providerLeagueCode)))
      .filter((event) => !search || event.name.toLowerCase().includes(search));
  }

  /**
   * One Season's slate, for the league's events sync (#2003): the events of the provider league its
   * selected provider mapping names (#1997), by the code the provider stamps on each, never by a
   * name, asked for by the provider's own id for the Season. The provider is asked for that league
   * alone, and a refusal of it by the provider's plan is a `PROVIDER_LEAGUE_REFUSED` error (#1797).
   * 422 SPORT_LEAGUE_NOT_SYNCED when the league has no selected mapping to this provider.
   */
  async listSeasonEvents(
    providerId: string,
    sportLeagueId: string,
    providerSeasonId: string,
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

    const events = await provider.getUpcomingEvents(sportLeague.sport.sport, undefined, { providerLeagueCode, providerSeasonId }).catch((error: unknown) => {
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
