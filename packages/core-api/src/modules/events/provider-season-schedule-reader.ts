/**
 * ProviderSeasonScheduleReader: the one place the events sync reads a provider's schedule for a sport
 * league's Season (#2003), through the provider registry. The sync alone gives an event its provider
 * id (#2004): there is no manual linking of an event to a provider event.
 */

import type { PrismaClient } from '@prisma/client';
import { SELECTED_PROVIDER_MAPPING_INCLUDE, toSelectedProviderMapping } from '../../adapters/prisma-sport-catalog-repositories';
import { ProviderRegistry } from '../ingestion/core/provider-registry';
import { ProviderLeagueRefusedError } from '../ingestion/core/provider-interface';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export class ProviderSeasonScheduleError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ProviderSeasonScheduleError';
  }
}

/** A provider event's own name, venue and dates, as a Season's slate lists it. */
export interface ProviderEventDetailSummary {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
}

export class ProviderSeasonScheduleReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerRegistry: ProviderRegistry = new ProviderRegistry(),
  ) {}

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
      throw new ProviderSeasonScheduleError(`Provider ${providerId} was not found.`, 'PROVIDER_NOT_FOUND', 404);
    }
    const sportLeague = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      include: { sport: true, ...SELECTED_PROVIDER_MAPPING_INCLUDE },
    });
    if (!sportLeague) {
      throw new ProviderSeasonScheduleError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const mapping = toSelectedProviderMapping(sportLeague.selectedProviderMapping);
    if (mapping === null || mapping.providerId !== providerId) {
      throw new ProviderSeasonScheduleError(
        `${sportLeague.name} is not synced from provider ${providerId}, so none of its leagues is ${sportLeague.name}'s.`,
        'SPORT_LEAGUE_NOT_SYNCED',
        422,
      );
    }
    const providerLeagueCode = mapping.providerLeagueCode;

    const events = await provider.getUpcomingEvents(sportLeague.sport.sport, undefined, { providerLeagueCode, providerSeasonId }).catch((error: unknown) => {
      // #1797 — the provider's plan leaves this league out: say so, not "something went wrong".
      if (error instanceof ProviderLeagueRefusedError) {
        throw new ProviderSeasonScheduleError(error.message, 'PROVIDER_LEAGUE_REFUSED', 422);
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
}
