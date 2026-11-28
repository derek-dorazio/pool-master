/**
 * ProviderSeasonScheduleReader: the one place a sync reads a provider for a sport league's Season,
 * through the provider registry: the events sync its schedule (#2003), the roster sync its roster
 * (#2025), the box score sync its games' box scores (#2026). The sync alone gives an event its provider
 * id (#2004): there is no manual linking of an event to a provider event.
 */

import type { PrismaClient } from '@prisma/client';
import { SELECTED_PROVIDER_MAPPING_INCLUDE, toSelectedProviderMapping } from '../../adapters/prisma-sport-catalog-repositories';
import { LeagueProviderNotResolvedError, ProviderRegistry, type LeagueProviderSource } from '../ingestion/core/provider-registry';
import { ProviderLeagueRefusedError, ProviderLeagueUnknownError, type ProviderPlayerGameStats, type ProviderRosterPlayer, type SportDataProvider } from '../ingestion/core/provider-interface';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import type { ProviderSession, ProviderSlotPlay, SportLeagueProviderMapping } from '@poolmaster/shared/domain';

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

/** A provider event's own name, venue and dates, and the places its games are in, as a Season's slate lists it. */
export interface ProviderEventDetailSummary {
  name: string;
  venue: string | null;
  startDate: Date;
  endDate: Date | null;
  providerSlots: ProviderSlotPlay[];
  /** Its sessions, where the provider lists them (#2045). */
  sessions?: ProviderSession[];
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
   * alone, and a refusal of it by the provider's plan is a `PROVIDER_LEAGUE_REFUSED` error (#1797);
   * a code the provider does not read is a `PROVIDER_LEAGUE_UNKNOWN` error, with nothing read (#2005).
   * The provider is the one that mapping names (#2073): 422 SPORT_LEAGUE_NOT_SYNCED when the league
   * has no selected mapping, 404 PROVIDER_NOT_FOUND when its provider is not running here.
   */
  async listSeasonEvents(
    sportLeagueId: string,
    providerSeasonId: string,
  ): Promise<Array<ProviderEventDetailSummary & { externalId: string }>> {
    const sportLeague = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      include: { sport: true, ...SELECTED_PROVIDER_MAPPING_INCLUDE },
    });
    if (!sportLeague) {
      throw new ProviderSeasonScheduleError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const { provider, mapping } = this.providerFor({ name: sportLeague.name, selectedProviderMapping: toSelectedProviderMapping(sportLeague.selectedProviderMapping) });
    const providerLeagueCode = mapping.providerLeagueCode;

    const events = await provider.getUpcomingEvents(sportLeague.sport.sport, undefined, { providerLeagueCode, providerSeasonId }).catch(asScheduleError);
    return events
      .filter((event) => event.providerLeagueCode === providerLeagueCode)
      .map((event) => ({
        externalId: event.externalId,
        name: event.name,
        venue: event.venue ?? null,
        startDate: event.startDate,
        endDate: event.endDate ?? null,
        providerSlots: event.providerSlots,
        ...(event.sessions !== undefined && { sessions: event.sessions }),
      }));
  }

  /**
   * The league's roster for one Season (#2025), from the provider league its selected mapping
   * names, asked for by the provider's own id for the Season. Errors as `listSeasonEvents`.
   */
  async listSeasonRoster(sportLeagueId: string, providerSeasonId: string): Promise<ProviderRosterPlayer[]> {
    const sportLeague = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      include: { sport: true, ...SELECTED_PROVIDER_MAPPING_INCLUDE },
    });
    if (!sportLeague) {
      throw new ProviderSeasonScheduleError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const { provider, mapping } = this.providerFor({ name: sportLeague.name, selectedProviderMapping: toSelectedProviderMapping(sportLeague.selectedProviderMapping) });
    if (provider.getRoster === undefined) return [];
    return provider.getRoster(sportLeague.sport.sport, { providerLeagueCode: mapping.providerLeagueCode, providerSeasonId }).catch(asScheduleError);
  }

  /**
   * The league's box scores for some of its games (#2026), from the provider league its selected
   * mapping names, asked for by the provider's own ids for the games. Errors as `listSeasonEvents`.
   */
  async listBoxScores(sportLeagueId: string, providerGameIds: readonly string[]): Promise<ProviderPlayerGameStats[]> {
    const sportLeague = await this.prisma.sportLeague.findUnique({
      where: { id: sportLeagueId },
      include: { sport: true, ...SELECTED_PROVIDER_MAPPING_INCLUDE },
    });
    if (!sportLeague) {
      throw new ProviderSeasonScheduleError(`Sport league ${sportLeagueId} was not found.`, 'SPORT_LEAGUE_NOT_FOUND', 404);
    }
    const { provider, mapping } = this.providerFor({ name: sportLeague.name, selectedProviderMapping: toSelectedProviderMapping(sportLeague.selectedProviderMapping) });
    if (provider.getBoxScores === undefined) return [];
    return provider.getBoxScores(sportLeague.sport.sport, { providerLeagueCode: mapping.providerLeagueCode, providerGameIds }).catch(asScheduleError);
  }

  /** The league's provider, through its selected mapping (#2073), as this reader's error. */
  private providerFor<M extends SportLeagueProviderMapping>(league: LeagueProviderSource<M>): { provider: SportDataProvider; mapping: M } {
    try {
      return this.providerRegistry.forLeague(league);
    } catch (error) {
      if (error instanceof LeagueProviderNotResolvedError) throw new ProviderSeasonScheduleError(error.message, error.code, error.statusCode);
      throw error;
    }
  }
}

/** A provider's refusal of a league as this reader's error; anything else as it came. */
function asScheduleError(error: unknown): never {
  // #1797 — the provider's plan leaves this league out: say so, not "something went wrong".
  if (error instanceof ProviderLeagueRefusedError) {
    throw new ProviderSeasonScheduleError(error.message, 'PROVIDER_LEAGUE_REFUSED', 422);
  }
  // #2005 — the mapping names a league the provider does not read: nothing was read.
  if (error instanceof ProviderLeagueUnknownError) {
    throw new ProviderSeasonScheduleError(error.message, 'PROVIDER_LEAGUE_UNKNOWN', 422);
  }
  throw error;
}
