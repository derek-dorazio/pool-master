/**
 * BalldontlieAdapter — the BALLDONTLIE provider behind the `SportDataProvider` port (#1495).
 *
 * PGA TOUR: the tournament schedule for the catalog browse and the year import, a
 * tournament's field with each golfer's world ranking, and live round scores in the GOLF
 * category. Plan tiers, as the vendor documents them: tournaments and players are free,
 * tournament results need ALL-STAR, the field (`tournament_competitors`) needs GOAT.
 *
 * NFL (#1496, `nfl-reader.ts`): regular season weeks and the postseason as events, their teams
 * (the postseason's seeded from the standings), their games, the postseason's bracket (#1728),
 * and their games' scores in the GAME category. An event id that names an NFL scope
 * (`nfl-2026-week-12`) is read as one.
 *
 * College Football Playoff (#1496, `ncaaf-reader.ts`): each season's playoff as an event
 * (`ncaaf-2025-cfp`), the teams playing in its window, and the window's games' scores in the GAME
 * category. The vendor marks no college game as a playoff game, so the playoff's games are the
 * season's from the day after conference championship Saturday through January 31
 * (`CFP_LEAGUE` in `ncaaf-mapping.ts`). Football's events and teams are the NFL's and college
 * football's, each league read on its own (#1797).
 *
 * NCAA basketball, men's and women's (#1496, `ncaa-tournament-reader.ts`): each season's
 * tournament as an event (`ncaab-2025-tournament`, `ncaaw-2025-tournament`), from the vendor's
 * bracket (GOAT tier), its teams with their seeds and its play-in places, its games, the men's
 * whole bracket (#1728), and its games' scores in the GAME category.
 *
 * NBA (#1496, `nba-mapping.ts` through the shared `series-playoffs-reader.ts`): each season's
 * playoffs as an event (`nba-2025-postseason`), its teams, and every playoff game's score in the
 * GAME category, from which the GAME writer counts each best-of-seven series' wins (#1545).
 * Basketball's events and teams are the NCAA tournaments', the NBA's and the WNBA's, each read on
 * its own.
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
 * with a shoot-out's scores (#1532). Soccer's events and teams are both leagues', each read on its
 * own, the Premier League's first. Any other event id is a PGA TOUR tournament id.
 *
 * This adapter only reads. A synced sport league's events are created from its event list by the
 * daily synced event creation sweep (ADR 0011); every other league's, by an admin.
 */

import type { FastifyBaseLogger } from 'fastify';
import { Sport, type ProviderLeagueSettings } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { errorMessage } from '../../../../core/error-message';
import {
  ProviderLeagueRefusedError,
  type DateRange,
  type ProviderEventListOptions,
  type ProviderHealthStatus,
  type ProviderParticipant,
  type ProviderPayloadCapture,
  type ProviderPayloadCaptureSession,
  type ProviderPayloadDiagnostics,
  type SportDataProvider,
  type SportEvent,
  type SportEventDetail,
} from '../../core/provider-interface';
import { ProviderPayloadRecorder } from '../provider-payload-recorder';
import { NCAA_MEN, NCAA_WOMEN, parseNcaaTournamentScope, type NcaaTournamentLeague } from './ncaa-tournament-mapping';
import { NcaaTournamentReader } from './ncaa-tournament-reader';
import { MLB_POSTSEASON, mlbPostseasonSource } from './mlb-mapping';
import { NBA_PLAYOFFS, nbaPlayoffsSource } from './nba-mapping';
import { WNBA_PLAYOFFS, wnbaPlayoffsSource } from './wnba-mapping';
import { NHL_PLAYOFFS, nhlPlayoffsSource } from './nhl-mapping';
import { parsePlayoffsScope } from './series-playoffs';
import { PlayoffsReader } from './series-playoffs-reader';
import { EPL_TOUR, parseEplScope } from './epl-mapping';
import { EplReader } from './epl-reader';
import { FIFA_WC_TOUR, parseWorldCupScope } from './fifa-world-cup-mapping';
import { WorldCupReader } from './fifa-world-cup-reader';
import { NFL_LEAGUE_NAME, parseNflScope } from './nfl-mapping';
import { NflReader } from './nfl-reader';
import { CFP_LEAGUE, parseCfpScope } from './ncaaf-mapping';
import { NcaafReader } from './ncaaf-reader';
import { BALLDONTLIE_MAX_PER_PAGE, BalldontlieClient, BalldontlieRequestError, type BalldontlieConnection, type BalldontlieQuery } from './balldontlie-client';
import { jobDeferredUntilOf } from '../../../background-jobs/job-error-type';
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
  PGA_TOUR_NAME,
  requireStrokePlay,
  toFieldParticipants,
  toGolfRoundUpdates,
  toSportEvent,
  toTourParticipant,
} from './pga-mapping';

export interface BalldontlieAdapterOptions {
  /** The BALLDONTLIE Provider row's base URL and rate, read for each request (#1997). */
  connection: () => BalldontlieConnection;
  apiKey: string;
  /**
   * The Provider's enabled leagues (#1997): only these are read, and the sports they play are the
   * ones the adapter covers.
   */
  leagues: readonly Pick<ProviderLeagueSettings, 'code' | 'sport'>[];
  /** The most tasks that run background work at once, each taking an even share of the limit; 1 when unset. */
  maxTasks?: number;
  /** For tests: the client's clock and wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Where a read the adapter can do without logs that it was refused or failed: a series
   * playoffs' standings, or one league of a sport's list (#1797).
   */
  logger?: FastifyBaseLogger;
}

/**
 * A date range spanning more seasons than this is read as "everything" (one unfiltered list)
 * rather than one request per season: the catalog browse passes open-ended bounds.
 */
const MAX_SEASONS_FETCHED_ONE_BY_ONE = 3;

/**
 * What the adapter reads for one league: its events in a date range, and everyone who plays in
 * it. `code` is the vendor's own code for the league (a ProviderLeague's `code`, #1997), stamped
 * on each of its events; `tour` is the league's word in the vendor's data, which names it in a
 * refusal and a log.
 */
interface LeagueReads {
  code: string;
  sport: Sport;
  tour: string;
  events(dateRange?: DateRange): Promise<SportEvent[]>;
  participants(): Promise<ProviderParticipant[]>;
}

/** A vendor answer saying the plan does not include a read. */
function isPlanRefusal(error: unknown): error is BalldontlieRequestError & { status: number } {
  return error instanceof BalldontlieRequestError && (error.status === 401 || error.status === 403);
}

/** A league's events, each stamped with the league's code. */
function withLeagueCode(league: LeagueReads, events: SportEvent[]): SportEvent[] {
  return events.map((event) => ({ ...event, providerLeagueCode: league.code }));
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
  private readonly ncaaf: NcaafReader;
  private readonly nba: PlayoffsReader;
  private readonly nhl: PlayoffsReader;
  private readonly mlb: PlayoffsReader;
  private readonly wnba: PlayoffsReader;
  private readonly epl: EplReader;
  private readonly worldCup: WorldCupReader;
  /** Each NCAA tournament league's reads, by its key. */
  private readonly ncaa: Readonly<Record<NcaaTournamentLeague['key'], NcaaTournamentReader>>;
  /** Each league's schedule and roster reads, by the sport it serves. */
  private readonly leagues: ReadonlyMap<Sport, readonly LeagueReads[]>;
  private readonly logger: FastifyBaseLogger | undefined;
  private readonly connection: () => BalldontlieConnection;

  constructor(options: BalldontlieAdapterOptions) {
    this.client = new BalldontlieClient({ ...options, providerId: this.providerId, payloads: this.payloads });
    this.connection = options.connection;
    this.logger = options.logger;
    this.nfl = new NflReader(this.client, options.now ?? Date.now);
    this.ncaaf = new NcaafReader(this.client, options.now ?? Date.now);
    this.nba = new PlayoffsReader(nbaPlayoffsSource(this.client), options.now ?? Date.now, options.logger);
    this.nhl = new PlayoffsReader(nhlPlayoffsSource(this.client), options.now ?? Date.now, options.logger);
    this.mlb = new PlayoffsReader(mlbPostseasonSource(this.client), options.now ?? Date.now, options.logger);
    this.wnba = new PlayoffsReader(wnbaPlayoffsSource(this.client), options.now ?? Date.now, options.logger);
    this.epl = new EplReader(this.client, options.now ?? Date.now);
    this.worldCup = new WorldCupReader(this.client);
    this.ncaa = {
      ncaab: new NcaaTournamentReader(this.client, NCAA_MEN, options.now ?? Date.now),
      ncaaw: new NcaaTournamentReader(this.client, NCAA_WOMEN, options.now ?? Date.now),
    };
    const reads = (code: string, sport: Sport, tour: string, reader: { upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]>; teams(): Promise<ProviderParticipant[]> }): LeagueReads => ({
      code,
      sport,
      tour,
      events: (dateRange) => reader.upcomingEvents(dateRange),
      participants: () => reader.teams(),
    });
    // The vendor's own league codes, each with its reader: the adapter's mapping of the vendor's
    // words, as its endpoint paths are. Which of them are read is the Provider's league rows.
    const readers: readonly LeagueReads[] = [
      { code: 'pga', sport: Sport.GOLF, tour: PGA_TOUR_NAME, events: (dateRange) => this.pgaTournaments(dateRange), participants: () => this.pgaPlayers() },
      reads('nfl', Sport.AMERICAN_FOOTBALL, NFL_LEAGUE_NAME, this.nfl),
      reads('ncaaf', Sport.AMERICAN_FOOTBALL, CFP_LEAGUE.tour, this.ncaaf),
      reads('ncaab', Sport.BASKETBALL, NCAA_MEN.tour, this.ncaa.ncaab),
      reads('ncaaw', Sport.BASKETBALL, NCAA_WOMEN.tour, this.ncaa.ncaaw),
      reads('nba', Sport.BASKETBALL, NBA_PLAYOFFS.tour, this.nba),
      reads('wnba', Sport.BASKETBALL, WNBA_PLAYOFFS.tour, this.wnba),
      reads('epl', Sport.SOCCER, EPL_TOUR, this.epl),
      reads('worldcup', Sport.SOCCER, FIFA_WC_TOUR, this.worldCup),
      reads('nhl', Sport.HOCKEY, NHL_PLAYOFFS.tour, this.nhl),
      reads('mlb', Sport.BASEBALL, MLB_POSTSEASON.tour, this.mlb),
    ];
    const enabled = new Set(options.leagues.map((league) => league.code));
    for (const league of options.leagues) {
      if (!readers.some((reader) => reader.code === league.code && reader.sport === league.sport)) {
        options.logger?.error(
          { action: 'balldontlie.league.noReader', providerLeagueCode: league.code, sport: league.sport },
          'A BALLDONTLIE league row names a league or sport the adapter has no reader for; it is not read',
        );
      }
    }
    // Each league is read on its own (#1797): a league the plan refuses (the NCAA brackets and
    // the World Cup need the GOAT tier, college football a paid one) or whose read fails is
    // left out of its sport's list and logged, and its neighbours still list.
    const leagues = new Map<Sport, LeagueReads[]>();
    for (const reader of readers.filter((each) => enabled.has(each.code))) {
      leagues.set(reader.sport, [...(leagues.get(reader.sport) ?? []), reader]);
    }
    this.leagues = leagues;
    this.sportsCovered = [...this.leagues.keys()];
  }

  /** The Provider row's rate, read for each request (#1997). */
  get requestsPerMinute(): number {
    return this.connection().requestsPerMinute;
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
   * The sport's events starting inside `dateRange`; none for a sport the adapter does not cover.
   * Given a `tour` that names one of the sport's leagues, only that league is read, and a refusal
   * of it throws `ProviderLeagueRefusedError` (#1797); otherwise every league is read on its own
   * (`eachLeague`).
   */
  async getUpcomingEvents(sport: Sport, dateRange?: DateRange, options?: ProviderEventListOptions): Promise<SportEvent[]> {
    const leagues = this.leagues.get(sport) ?? [];
    const code = options?.providerLeagueCode;
    if (code === undefined) {
      return this.eachLeague(sport, leagues, 'events', async (league) => withLeagueCode(league, await league.events(dateRange)));
    }
    const named = leagues.filter((league) => league.code === code);
    if (named.length === 0) {
      // A code no enabled league of the sport carries (a league switched off, or mapped to
      // another sport) has no events here: reading every league instead would hand back
      // another league's list as if it were this one's.
      this.logger?.warn({ action: 'balldontlie.league.not_enabled', sport, providerLeagueCode: code }, 'BALLDONTLIE has no enabled league with this code for the sport');
      return [];
    }
    return (await Promise.all(named.map(async (league) => {
      try {
        return withLeagueCode(league, await league.events(dateRange));
      } catch (error) {
        if (isPlanRefusal(error)) throw new ProviderLeagueRefusedError(this.providerName, league.tour, error.status, { cause: error });
        throw error;
      }
    }))).flat();
  }

  /**
   * Each of a sport's leagues read on its own, their lists together. A league whose read is
   * refused or fails is left out and logged (`balldontlie.league.unavailable`), so one league's
   * plan or outage never empties its neighbours' lists; when every league fails, the first
   * failure is thrown, as a one-league sport's always is. A league the provider rate limits is
   * never left out: its refusal is thrown, so the job is deferred rather than syncing a partial list.
   */
  private async eachLeague<Item>(sport: Sport, leagues: readonly LeagueReads[], what: 'events' | 'participants', read: (league: LeagueReads) => Promise<Item[]>): Promise<Item[]> {
    const results = await Promise.allSettled(leagues.map(read));
    const failures = results.flatMap((result, index) => (result.status === 'rejected' ? [{ league: leagues[index], reason: result.reason as unknown }] : []));
    if (failures.length > 0 && failures.length === results.length) throw failures[0].reason;
    // A rate-limited league is not missing from the feed: leaving it out would sync a partial list
    // as if it were whole. Its refusal ends the read, and the job runs again when the provider answers.
    const rateLimited = failures.find(({ reason }) => jobDeferredUntilOf(reason) !== null);
    if (rateLimited) throw rateLimited.reason;
    for (const { league, reason } of failures) {
      this.logger?.warn(
        {
          action: 'balldontlie.league.unavailable',
          sport,
          league: league.tour,
          providerLeagueCode: league.code,
          read: what,
          refused: isPlanRefusal(reason),
          status: reason instanceof BalldontlieRequestError ? reason.status : null,
          path: reason instanceof BalldontlieRequestError ? reason.path : null,
          error: errorMessage(reason),
        },
        `Left a league out of the sport's ${what}: its read was refused or failed`,
      );
    }
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
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

  /** The tournament, NFL scope, College Football Playoff, NCAA tournament, NBA, WNBA or NHL playoffs, MLB postseason, Premier League matchweek or World Cup bracket with its field; null when the vendor has no such event. */
  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const scope = parseNflScope(eventId);
    if (scope) {
      return this.nfl.eventDetails(scope);
    }
    const cfpScope = parseCfpScope(eventId);
    if (cfpScope) {
      return this.ncaaf.eventDetails(cfpScope);
    }
    const ncaaScope = parseNcaaTournamentScope(eventId);
    if (ncaaScope) {
      return this.ncaa[ncaaScope.league.key].eventDetails(ncaaScope.season);
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

  /** Every active PGA TOUR golfer, every NFL and college football team, every Division I men's and women's basketball team, NBA team and WNBA team, every NHL team, every MLB team, or the Premier League's and the World Cup's teams; none for a sport the adapter does not cover. */
  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    return this.eachLeague(sport, this.leagues.get(sport) ?? [], 'participants', (league) => league.participants());
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
   * An NFL scope's, a College Football Playoff's, an NCAA tournament's, an NBA, WNBA or NHL playoffs', an MLB postseason's, a Premier League matchweek's or a World Cup bracket's games in the GAME category, or every started round of every golfer in a
   * stroke-play tournament. A tournament id the vendor does not know, or a tournament of another
   * format, fails the sync rather than returning nothing.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const scope = parseNflScope(eventId);
    if (scope) {
      return this.nfl.liveScores(scope);
    }
    const cfpScope = parseCfpScope(eventId);
    if (cfpScope) {
      return this.ncaaf.liveScores(cfpScope);
    }
    const ncaaScope = parseNcaaTournamentScope(eventId);
    if (ncaaScope) {
      return this.ncaa[ncaaScope.league.key].liveScores(ncaaScope.season);
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
