/**
 * BalldontlieAdapter — the BALLDONTLIE provider behind the `SportDataProvider` port (#1495).
 *
 * PGA TOUR: the tournament schedule for the catalog browse and the year import, a
 * tournament's field with each golfer's world ranking, and live round scores in the GOLF
 * category. Plan tiers, as the vendor documents them: tournaments and players are free,
 * tournament results need ALL-STAR, the field (`tournament_competitors`) needs GOAT.
 *
 * NFL (#1496, `nfl-reader.ts`): regular season weeks and the postseason as events, their teams,
 * and their games' scores in the GAME category. An event id that names an NFL scope
 * (`nfl-2026-week-12`) is read as one.
 *
 * NCAA basketball, men's and women's (#1496, `ncaa-tournament-reader.ts`): each season's
 * tournament as an event (`ncaab-2025-tournament`, `ncaaw-2025-tournament`), from the vendor's
 * bracket (GOAT tier), its teams with their seeds, and its games' scores in the GAME category.
 *
 * NBA (#1496, `nba-mapping.ts` through the shared `series-playoffs-reader.ts`): each season's
 * playoffs as an event (`nba-2025-postseason`), its teams, and every playoff game's score in the
 * GAME category, from which the GAME writer counts each best-of-seven series' wins (#1545).
 * Basketball's events and teams are the NCAA tournaments', the NBA's and the WNBA's together.
 * Each playoff round is an event too (#1497, `series-playoff-rounds.ts`): a Clutch Card's
 * (`nba-2025-postseason-round-4`, the NBA Finals), its teams' active players, and its games' box
 * scores in the STAT_LINE category.
 *
 * NHL (#1496, `nhl-mapping.ts` through the same shared reader): each season's playoffs as an
 * event (`nhl-2025-postseason`), its teams, and every playoff game's score in the GAME category,
 * each round a best of seven.
 *
 * MLB (#1496, `mlb-mapping.ts` through the same shared reader): each season's postseason as an
 * event (`mlb-2026-postseason`), its teams, and every postseason game's score in the GAME
 * category, from the best-of-three Wild Card Series to the World Series.
 *
 * WNBA (#1496, `wnba-mapping.ts` through the same shared reader): each season's playoffs as an
 * event (`wnba-2026-postseason`), its teams, and every playoff game's score in the GAME category.
 *
 * Premier League (#1496, `epl-reader.ts`): each season's matchweeks as events
 * (`epl-2026-matchweek-11`), their teams, and their matches' scores in the GAME category.
 *
 * FIFA World Cup (#1496, `fifa-world-cup-reader.ts`): each edition's knockout bracket as an event
 * (`fifa-wc-2026-knockout`, GOAT tier), its teams, and its matches' scores in the GAME category,
 * with a shoot-out's scores (#1532). Soccer's events and teams are both leagues', one after the
 * other. Any other event id is a PGA TOUR tournament id.
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
import { NCAA_MEN, NCAA_WOMEN, parseNcaaTournamentScope, type NcaaTournamentLeague } from './ncaa-tournament-mapping';
import { NcaaTournamentReader } from './ncaa-tournament-reader';
import { MLB_POSTSEASON, mlbPostseasonSource } from './mlb-mapping';
import { NBA_PLAYOFFS, nbaPlayoffsSource } from './nba-mapping';
import { WNBA_PLAYOFFS, wnbaPlayoffsSource } from './wnba-mapping';
import { NHL_PLAYOFFS, nhlPlayoffsSource } from './nhl-mapping';
import { parsePlayoffRoundScope } from './series-playoff-rounds';
import { parsePlayoffsScope } from './series-playoffs';
import { PlayoffRoundsReader, PlayoffsReader } from './series-playoffs-reader';
import { parseEplScope } from './epl-mapping';
import { EplReader } from './epl-reader';
import { parseWorldCupScope } from './fifa-world-cup-mapping';
import { WorldCupReader } from './fifa-world-cup-reader';
import { parseNflScope } from './nfl-mapping';
import { NflReader } from './nfl-reader';
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

/** What the adapter reads for one league: its events in a date range, and everyone who plays in it. */
interface LeagueReads {
  events(dateRange?: DateRange): Promise<SportEvent[]>;
  participants(): Promise<ProviderParticipant[]>;
}

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
  readonly sportsCovered: Sport[];
  private readonly payloads = new ProviderPayloadRecorder('balldontlie.request');
  private readonly client: BalldontlieClient;
  private readonly nfl: NflReader;
  private readonly nba: PlayoffRoundsReader;
  private readonly nhl: PlayoffsReader;
  private readonly mlb: PlayoffsReader;
  private readonly wnba: PlayoffsReader;
  private readonly epl: EplReader;
  private readonly worldCup: WorldCupReader;
  /** Each NCAA tournament league's reads, by its key. */
  private readonly ncaa: Readonly<Record<NcaaTournamentLeague['key'], NcaaTournamentReader>>;
  /** Each league's schedule and roster reads, by the sport it serves. */
  private readonly leagues: ReadonlyMap<Sport, LeagueReads>;

  constructor(options: BalldontlieAdapterOptions) {
    this.client = new BalldontlieClient({ ...options, payloads: this.payloads });
    this.nfl = new NflReader(this.client, options.now ?? Date.now);
    this.nba = new PlayoffRoundsReader(nbaPlayoffsSource(this.client), options.now ?? Date.now);
    this.nhl = new PlayoffsReader(nhlPlayoffsSource(this.client), options.now ?? Date.now);
    this.mlb = new PlayoffsReader(mlbPostseasonSource(this.client), options.now ?? Date.now);
    this.wnba = new PlayoffsReader(wnbaPlayoffsSource(this.client), options.now ?? Date.now);
    this.epl = new EplReader(this.client, options.now ?? Date.now);
    this.worldCup = new WorldCupReader(this.client);
    this.ncaa = {
      ncaab: new NcaaTournamentReader(this.client, NCAA_MEN, options.now ?? Date.now),
      ncaaw: new NcaaTournamentReader(this.client, NCAA_WOMEN, options.now ?? Date.now),
    };
    const ncaaReaders = Object.values(this.ncaa);
    this.leagues = new Map<Sport, LeagueReads>([
      [Sport.GOLF, { events: (dateRange) => this.pgaTournaments(dateRange), participants: () => this.pgaPlayers() }],
      [Sport.AMERICAN_FOOTBALL, { events: (dateRange) => this.nfl.upcomingEvents(dateRange), participants: () => this.nfl.teams() }],
      // Read together, as soccer's are: the NCAA brackets need the GOAT tier, so a plan without
      // it loses the NBA's and the WNBA's playoffs from the list too.
      [Sport.BASKETBALL, {
        events: async (dateRange) => (await Promise.all([...ncaaReaders.map((reader) => reader.upcomingEvents(dateRange)), this.nba.upcomingEvents(dateRange), this.wnba.upcomingEvents(dateRange)])).flat(),
        participants: async () => (await Promise.all([...ncaaReaders.map((reader) => reader.teams()), this.nba.teams(), this.wnba.teams()])).flat(),
      }],
      // Read together, so a failed read fails the sport's whole list: the World Cup's matches
      // need the GOAT tier, which the NCAA brackets need too, so a plan without it loses
      // soccer's events as well as basketball's, the Premier League's with them.
      [Sport.SOCCER, {
        events: async (dateRange) => (await Promise.all([this.epl.upcomingEvents(dateRange), this.worldCup.upcomingEvents(dateRange)])).flat(),
        participants: async () => (await Promise.all([this.epl.teams(), this.worldCup.teams()])).flat(),
      }],
      [Sport.HOCKEY, { events: (dateRange) => this.nhl.upcomingEvents(dateRange), participants: () => this.nhl.teams() }],
      [Sport.BASEBALL, { events: (dateRange) => this.mlb.upcomingEvents(dateRange), participants: () => this.mlb.teams() }],
    ]);
    this.sportsCovered = [...this.leagues.keys()];
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

  /** The sport's events starting inside `dateRange`; none for a sport the adapter does not cover. */
  async getUpcomingEvents(sport: Sport, dateRange?: DateRange): Promise<SportEvent[]> {
    return await this.leagues.get(sport)?.events(dateRange) ?? [];
  }

  /**
   * PGA TOUR tournaments starting inside `dateRange` (every season when it is open-ended or
   * absent). A tournament whose lifecycle the vendor marks `unknown` is left out: it cannot be
   * shown with an honest status.
   */
  private async pgaTournaments(dateRange?: DateRange): Promise<SportEvent[]> {
    const tournaments = await this.listTournaments(seasonsFor(dateRange));
    return tournaments
      .filter(isClassifiedTournament)
      .map((tournament) => toSportEvent(tournament))
      .filter((event) => !dateRange
        || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** The tournament, NFL scope, NCAA tournament, NBA, WNBA or NHL playoffs, MLB postseason, Premier League matchweek or World Cup bracket with its field; null when the vendor has no such event. */
  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const scope = parseNflScope(eventId);
    if (scope) {
      return this.nfl.eventDetails(scope);
    }
    const ncaaScope = parseNcaaTournamentScope(eventId);
    if (ncaaScope) {
      return this.ncaa[ncaaScope.league.key].eventDetails(ncaaScope.season);
    }
    const nbaRound = parsePlayoffRoundScope(NBA_PLAYOFFS, eventId);
    if (nbaRound !== null) {
      return this.nba.roundEventDetails(nbaRound.season, nbaRound.round);
    }
    const nbaSeason = parsePlayoffsScope(NBA_PLAYOFFS, eventId);
    if (nbaSeason !== null) {
      return this.nba.eventDetails(nbaSeason);
    }
    const wnbaSeason = parsePlayoffsScope(WNBA_PLAYOFFS, eventId);
    if (wnbaSeason !== null) {
      return this.wnba.eventDetails(wnbaSeason);
    }
    const nhlSeason = parsePlayoffsScope(NHL_PLAYOFFS, eventId);
    if (nhlSeason !== null) {
      return this.nhl.eventDetails(nhlSeason);
    }
    const mlbSeason = parsePlayoffsScope(MLB_POSTSEASON, eventId);
    if (mlbSeason !== null) {
      return this.mlb.eventDetails(mlbSeason);
    }
    const eplScope = parseEplScope(eventId);
    if (eplScope) {
      return this.epl.eventDetails(eplScope);
    }
    const worldCupScope = parseWorldCupScope(eventId);
    if (worldCupScope) {
      return this.worldCup.eventDetails(worldCupScope);
    }
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

  /** Every active PGA TOUR golfer, every NFL team, every Division I men's and women's basketball team, NBA team and WNBA team, every NHL team, every MLB team, or the Premier League's and the World Cup's teams; none for a sport the adapter does not cover. */
  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    return await this.leagues.get(sport)?.participants() ?? [];
  }

  private async pgaPlayers(): Promise<ProviderParticipant[]> {
    const players = await this.client.getAllPages(
      '/pga/v1/players',
      { active: true },
      pgaPlayerListSchema,
    );
    return players.map(toTourParticipant);
  }

  /**
   * An NFL scope's, an NCAA tournament's, an NBA, WNBA or NHL playoffs', an MLB postseason's, a Premier League matchweek's or a World Cup bracket's games in the GAME category, or every started round of every golfer in a
   * stroke-play tournament. A tournament id the vendor does not know, or a tournament of another
   * format, fails the sync rather than returning nothing.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const scope = parseNflScope(eventId);
    if (scope) {
      return this.nfl.liveScores(scope);
    }
    const ncaaScope = parseNcaaTournamentScope(eventId);
    if (ncaaScope) {
      return this.ncaa[ncaaScope.league.key].liveScores(ncaaScope.season);
    }
    const nbaRound = parsePlayoffRoundScope(NBA_PLAYOFFS, eventId);
    if (nbaRound !== null) {
      return this.nba.roundLiveScores(nbaRound.season, nbaRound.round);
    }
    const nbaSeason = parsePlayoffsScope(NBA_PLAYOFFS, eventId);
    if (nbaSeason !== null) {
      return this.nba.liveScores(nbaSeason);
    }
    const wnbaSeason = parsePlayoffsScope(WNBA_PLAYOFFS, eventId);
    if (wnbaSeason !== null) {
      return this.wnba.liveScores(wnbaSeason);
    }
    const nhlSeason = parsePlayoffsScope(NHL_PLAYOFFS, eventId);
    if (nhlSeason !== null) {
      return this.nhl.liveScores(nhlSeason);
    }
    const mlbSeason = parsePlayoffsScope(MLB_POSTSEASON, eventId);
    if (mlbSeason !== null) {
      return this.mlb.liveScores(mlbSeason);
    }
    const eplScope = parseEplScope(eventId);
    if (eplScope) {
      return this.epl.liveScores(eplScope);
    }
    const worldCupScope = parseWorldCupScope(eventId);
    if (worldCupScope) {
      return this.worldCup.liveScores(worldCupScope);
    }
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
