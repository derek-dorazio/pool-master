/**
 * BalldontlieAdapter — the BALLDONTLIE provider behind the `SportDataProvider` port (#1495).
 *
 * PGA TOUR first: the tournament schedule for the catalog browse and the year import, a
 * tournament's field with each golfer's world ranking, and live round scores in the GOLF
 * category. Plan tiers, as the vendor documents them: tournaments and players are free,
 * tournament results need ALL-STAR, the field (`tournament_competitors`) needs GOAT.
 *
 * Admins author every event; this adapter only reads (ADR 0009).
 */

import { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { errorMessage } from '../../../../core/error-message';
import type {
  DateRange,
  ProviderHealthStatus,
  ProviderParticipant,
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../core/provider-interface';
import { ProviderPayloadRecorder } from '../provider-payload-recorder';
import { BALLDONTLIE_MAX_PER_PAGE, BalldontlieClient, type BalldontlieQuery } from './balldontlie-client';
import {
  PgaCompetitorType,
  pgaPlayerListSchema,
  pgaTournamentCompetitorListSchema,
  pgaTournamentListSchema,
  pgaTournamentResultListSchema,
  type PgaTournament,
} from './pga-contract';
import {
  BALLDONTLIE_PROVIDER_ID,
  fieldPlayerIds,
  isClassifiedTournament,
  requireStrokePlay,
  toFieldParticipants,
  toGolfRoundUpdates,
  toSportEvent,
  toTourParticipant,
} from './pga-mapping';

export interface BalldontlieAdapterOptions {
  baseUrl: string;
  apiKey: string;
  requestsPerMinute: number;
  /** For tests: the client's clock and wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A date range spanning more seasons than this is read as "everything" (one unfiltered list)
 * rather than one request per season: the catalog browse passes open-ended bounds.
 */
const MAX_SEASONS_FETCHED_ONE_BY_ONE = 3;

/** A vendor tournament id: a positive whole number. Anything else cannot name one. */
const TOURNAMENT_ID_PATTERN = /^[1-9]\d{0,9}$/;

const TOURNAMENTS_PATH = '/pga/v2/tournaments';

/**
 * The vendor serves `format_type` only when `include_format=true` is sent, and the tournament
 * schema requires it, so every tournament read adds the flag here.
 */
function withFormat(query: BalldontlieQuery): BalldontlieQuery {
  return { ...query, include_format: true };
}

export class BalldontlieAdapter implements SportDataProvider, ProviderPayloadDiagnostics {
  readonly providerId = BALLDONTLIE_PROVIDER_ID;
  readonly providerName = 'BALLDONTLIE';
  readonly sportsCovered: Sport[] = [Sport.GOLF];
  private readonly payloads = new ProviderPayloadRecorder('balldontlie.request');
  private readonly client: BalldontlieClient;

  constructor(options: BalldontlieAdapterOptions) {
    this.client = new BalldontlieClient({ ...options, payloads: this.payloads });
  }

  clearProviderPayloads(): void {
    this.payloads.clearProviderPayloads();
  }

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    return this.payloads.consumeProviderPayloads();
  }

  beginProviderPayloadCapture(): ProviderPayloadCaptureSession {
    return this.payloads.beginProviderPayloadCapture();
  }

  /**
   * PGA TOUR tournaments starting inside `dateRange` (every season when it is open-ended or
   * absent). A tournament whose lifecycle the vendor marks `unknown` is left out: it cannot be
   * shown with an honest status.
   */
  async getUpcomingEvents(sport: Sport, dateRange?: DateRange): Promise<SportEvent[]> {
    if (!this.sportsCovered.includes(sport)) {
      return [];
    }
    const tournaments = await this.listTournaments(seasonsFor(dateRange));
    return tournaments
      .filter(isClassifiedTournament)
      .map((tournament) => toSportEvent(tournament))
      .filter((event) => !dateRange
        || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The tournament with its field; null when the vendor has no tournament with this id. */
  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const tournament = await this.findTournament(eventId);
    if (!tournament) {
      return null;
    }
    const competitors = await this.client.getAllPages(
      '/pga/v2/tournament_competitors',
      { tournament_id: tournament.id, 'competitor_types[]': [PgaCompetitorType.PLAYER] },
      pgaTournamentCompetitorListSchema,
    );
    const rankings = await this.readWorldRankings(fieldPlayerIds(competitors));
    const participants = toFieldParticipants(competitors, rankings);
    return { ...toSportEvent(tournament, participants.length), participants };
  }

  /** Every active PGA TOUR golfer. */
  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    if (!this.sportsCovered.includes(sport)) {
      return [];
    }
    const players = await this.client.getAllPages(
      '/pga/v1/players',
      { active: true },
      pgaPlayerListSchema,
    );
    return players.map(toTourParticipant);
  }

  /**
   * Every started round of every golfer in a stroke-play tournament. An id the vendor does not
   * know, or a tournament of another format, fails the sync rather than returning nothing.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const tournament = await this.findTournament(eventId);
    if (!tournament) {
      throw new Error(`BALLDONTLIE has no PGA TOUR tournament ${eventId}.`);
    }
    requireStrokePlay(tournament);
    const results = await this.client.getAllPages(
      '/pga/v2/tournament_results',
      { tournament_id: tournament.id },
      pgaTournamentResultListSchema,
    );
    return { category: 'GOLF', externalEventId: eventId, rounds: toGolfRoundUpdates(tournament, results) };
  }

  /** One small free-tier read: it proves the key, the plan and the network path together. */
  async healthCheck(): Promise<ProviderHealthStatus> {
    const startedAt = Date.now();
    try {
      await this.readTournamentPage({ per_page: 1 });
      return {
        providerId: this.providerId,
        status: 'HEALTHY',
        errorRateLastHour: 0,
        latencyMsP95: Date.now() - startedAt,
        lastSuccessfulPoll: new Date(),
      };
    } catch (error) {
      return {
        providerId: this.providerId,
        status: 'DOWN',
        errorRateLastHour: 1,
        latencyMsP95: Date.now() - startedAt,
        message: errorMessage(error),
      };
    }
  }

  /** One page of tournaments. Every tournament read goes through here or `listTournaments`. */
  private readTournamentPage(query: BalldontlieQuery) {
    return this.client.get(TOURNAMENTS_PATH, withFormat(query), pgaTournamentListSchema);
  }

  private async findTournament(eventId: string): Promise<PgaTournament | null> {
    if (!TOURNAMENT_ID_PATTERN.test(eventId)) {
      return null;
    }
    const page = await this.readTournamentPage({ 'tournament_ids[]': [Number(eventId)] });
    return page.data.find((tournament) => tournament.id === Number(eventId)) ?? null;
  }

  /** `seasons` empty means every season, in one unfiltered list. */
  private async listTournaments(seasons: readonly number[]): Promise<PgaTournament[]> {
    const read = (season?: number) => this.client.getAllPages(
      TOURNAMENTS_PATH,
      withFormat({ season }),
      pgaTournamentListSchema,
    );
    if (seasons.length === 0) {
      return read();
    }
    const tournaments: PgaTournament[] = [];
    for (const season of seasons) {
      tournaments.push(...await read(season));
    }
    return tournaments;
  }

  /** Each player's world ranking, read a page of ids at a time. */
  private async readWorldRankings(playerIds: readonly number[]): Promise<Map<number, number | null>> {
    const rankings = new Map<number, number | null>();
    for (let start = 0; start < playerIds.length; start += BALLDONTLIE_MAX_PER_PAGE) {
      const players = await this.client.getAllPages(
        '/pga/v1/players',
        { 'player_ids[]': playerIds.slice(start, start + BALLDONTLIE_MAX_PER_PAGE) },
        pgaPlayerListSchema,
      );
      for (const player of players) {
        rankings.set(player.id, player.owgr ?? null);
      }
    }
    return rankings;
  }
}

/**
 * The PGA TOUR seasons a date range covers, one request each. Since 2024 a PGA TOUR season is
 * the calendar year, so a tournament's season is the year it starts. Empty means "read every
 * season at once": no range, or a range too wide to walk season by season.
 */
function seasonsFor(dateRange?: DateRange): number[] {
  if (!dateRange) {
    return [];
  }
  const first = dateRange.from.getUTCFullYear();
  const last = dateRange.to.getUTCFullYear();
  if (last - first + 1 > MAX_SEASONS_FETCHED_ONE_BY_ONE) {
    return [];
  }
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
