/**
 * BalldontlieAdapter — the BALLDONTLIE provider behind the `SportDataProvider` port (#1495).
 *
 * PGA TOUR: the tournament schedule for the events sync, a
 * tournament's field with each golfer's world ranking, and live round scores in the GOLF
 * category. Plan tiers, as the vendor documents them: tournaments and players are free,
 * tournament results need ALL-STAR, the field (`tournament_competitors`) needs GOAT.
 *
 * NFL (#1496, `nfl-reader.ts`): regular season weeks and the postseason as events, their teams
 * (the postseason's seeded from the standings), their games, the postseason's bracket (#1728),
 * and their games' scores in the GAME category. An event id that names an NFL scope
 * (`nfl-2026-week-12`) is read as one. Its roster is the active players, each with their team and
 * position code (#2025).
 *
 * College Football Playoff (#1496, `ncaaf-reader.ts`): each season's playoff as an event
 * (`ncaaf-2025-cfp`) carrying the season's games, and the scores of the games around now in the
 * GAME category. The vendor marks no college game as a playoff game, so the events sync places
 * the games by the Season slots' date windows (#2012), and the field is the seeds placed on it. Football's events and teams are the NFL's and college
 * football's, each league read on its own (#1797).
 *
 * NCAA basketball, men's and women's (#1496, `ncaa-tournament-reader.ts`): each season's
 * tournament as an event (`ncaab-2025-tournament`, `ncaaw-2025-tournament`), from the vendor's
 * bracket (GOAT tier), its teams with their seeds, its First Four as round 1, its games, the men's
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
import { ProviderCode, type ProviderLeagueSettings, type Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { errorMessage } from '../../../../core/error-message';
import {
  ProviderLeagueRefusedError,
  ProviderLeagueUnknownError,
  type DateRange,
  type ProviderEventListOptions,
  type ProviderParticipant,
  type ProviderRosterPlayer,
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
import { parsePlayoffsScope, type PlayoffsLeague } from './series-playoffs';
import { PlayoffsReader } from './series-playoffs-reader';
import { parseEplScope } from './epl-mapping';
import { EplReader } from './epl-reader';
import { parseWorldCupScope } from './fifa-world-cup-mapping';
import { WorldCupReader } from './fifa-world-cup-reader';
import { parseNflScope } from './nfl-mapping';
import { NflReader } from './nfl-reader';
import { parseCfpScope } from './ncaaf-mapping';
import { NcaafReader } from './ncaaf-reader';
import { BALLDONTLIE_MAX_PER_PAGE, BalldontlieClient, BalldontlieRequestError, type BalldontlieConnection, type BalldontlieQuery } from './balldontlie-client';
import { jobDeferredUntilOf } from '../../../background-jobs/job-error-type';
import type { ProviderRateLimitObserver } from '../../core/provider-call-policy';
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
  isTournamentFinal,
  toSportEvent,
  toTourParticipant,
} from './pga-mapping';
import { F1Reader } from './f1-reader';
import { parseF1Scope } from './f1-mapping';

export interface BalldontlieAdapterOptions {
  /** The BALLDONTLIE Provider row's base URL and rate, read for each request (#1997). */
  connection: () => BalldontlieConnection;
  apiKey: string;
  /**
   * The Provider's enabled leagues (#1997): only these are read, and the sports they play are the
   * ones the adapter covers.
   */
  leagues: readonly Pick<ProviderLeagueSettings, 'code' | 'sport' | 'name'>[];
  /** The most tasks that run background work at once, each taking an even share of the limit; 1 when unset. */
  maxTasks?: number;
  /** For tests: the client's clock and wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Told how each call ends, for the Provider's rate-limit finding (league model 1c). */
  rateLimits?: ProviderRateLimitObserver;
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
 * One league's reads of one of its own events: the reader recognises the id by its own shape.
 */
interface LeagueEventReads {
  details(): Promise<SportEventDetail | null>;
  liveScores(): Promise<LiveScoreResult>;
}

/**
 * What the adapter reads for one of the vendor's leagues: its events in a date range, everyone
 * who plays in it, and one of its events by id (null when the id is not one of its).
 */
interface LeagueReader {
  events(dateRange?: DateRange, season?: number): Promise<SportEvent[]>;
  participants(): Promise<ProviderParticipant[]>;
  /** The league's roster for a season (#2025); absent for a league whose roster is not read. */
  roster?(season: number | undefined): Promise<ProviderRosterPlayer[]>;
  event(eventId: string): LeagueEventReads | null;
}

/** A Provider league row the adapter reads (#1997): the row's code, sport and name, with its reader. */
interface EnabledLeague extends Pick<ProviderLeagueSettings, 'code' | 'sport' | 'name'> {
  reader: LeagueReader;
}

/** A reader whose events are scopes of games, each id parsing to one of its scopes. */
interface ScopeReader<Scope> {
  upcomingEvents(dateRange?: DateRange, season?: number): Promise<SportEvent[]>;
  teams(): Promise<ProviderParticipant[]>;
  eventDetails(scope: Scope): Promise<SportEventDetail | null>;
  liveScores(scope: Scope): Promise<LiveScoreResult>;
}

function scopedReader<Scope>(parse: (eventId: string) => Scope | null, reader: ScopeReader<Scope>): LeagueReader {
  return {
    events: (dateRange, season) => reader.upcomingEvents(dateRange, season),
    participants: () => reader.teams(),
    event: (eventId) => {
      const scope = parse(eventId);
      return scope === null ? null : { details: () => reader.eventDetails(scope), liveScores: () => reader.liveScores(scope) };
    },
  };
}

/** An NCAA tournament league's reader: its ids name the league's key and a season. */
function ncaaReader(reader: NcaaTournamentReader, league: NcaaTournamentLeague): LeagueReader {
  return scopedReader((eventId) => {
    const scope = parseNcaaTournamentScope(eventId);
    return scope !== null && scope.league.key === league.key ? scope.season : null;
  }, reader);
}

/** A series playoffs league's reader: its ids name the league and a season. */
function playoffsReader(league: PlayoffsLeague, reader: PlayoffsReader): LeagueReader {
  return scopedReader((eventId) => parsePlayoffsScope(league, eventId), reader);
}

/** A vendor answer saying the plan does not include a read. */
function isPlanRefusal(error: unknown): error is BalldontlieRequestError & { status: number } {
  return error instanceof BalldontlieRequestError && (error.status === 401 || error.status === 403);
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
  readonly providerCode = ProviderCode.BALLDONTLIE;
  readonly providerName = 'BALLDONTLIE';
  private readonly payloads = new ProviderPayloadRecorder('balldontlie.request');
  private readonly client: BalldontlieClient;
  /** The Provider's enabled leagues the adapter has a reader for, in the rows' order. */
  private readonly leagues: readonly EnabledLeague[];
  private readonly logger: FastifyBaseLogger | undefined;
  private readonly connection: () => BalldontlieConnection;

  constructor(options: BalldontlieAdapterOptions) {
    this.client = new BalldontlieClient({ ...options, providerId: this.providerId, payloads: this.payloads });
    this.connection = options.connection;
    this.logger = options.logger;
    const now = options.now ?? Date.now;
    // Each of the vendor's league codes with the reader for its endpoints: the vendor's own words,
    // as its endpoint paths are. Which leagues are read, their sport and their name are the
    // Provider's league rows (#1997).
    const readers: Readonly<Record<string, () => LeagueReader>> = {
      pga: () => ({
        events: (dateRange, season) => this.pgaTournaments(dateRange, season),
        participants: () => this.pgaPlayers(),
        event: (eventId) => (TOURNAMENT_ID_PATTERN.test(eventId)
          ? { details: () => this.tournamentDetails(eventId), liveScores: () => this.tournamentScores(eventId) }
          : null),
      }),
      nfl: () => {
        const reader = new NflReader(this.client);
        return { ...scopedReader(parseNflScope, reader), roster: () => reader.roster() };
      },
      ncaaf: () => scopedReader(parseCfpScope, new NcaafReader(this.client, now)),
      ncaab: () => ncaaReader(new NcaaTournamentReader(this.client, NCAA_MEN), NCAA_MEN),
      ncaaw: () => ncaaReader(new NcaaTournamentReader(this.client, NCAA_WOMEN), NCAA_WOMEN),
      nba: () => playoffsReader(NBA_PLAYOFFS, new PlayoffsReader(nbaPlayoffsSource(this.client), options.logger)),
      wnba: () => playoffsReader(WNBA_PLAYOFFS, new PlayoffsReader(wnbaPlayoffsSource(this.client), options.logger)),
      nhl: () => playoffsReader(NHL_PLAYOFFS, new PlayoffsReader(nhlPlayoffsSource(this.client), options.logger)),
      mlb: () => playoffsReader(MLB_POSTSEASON, new PlayoffsReader(mlbPostseasonSource(this.client), options.logger)),
      epl: () => scopedReader(parseEplScope, new EplReader(this.client)),
      worldcup: () => scopedReader(parseWorldCupScope, new WorldCupReader(this.client)),
      f1: () => {
        const f1 = new F1Reader(this.client);
        return scopedReader(parseF1Scope, { upcomingEvents: (dateRange, season) => f1.upcomingEvents(dateRange, season), teams: () => f1.drivers(), eventDetails: (eventId) => f1.eventDetails(eventId), liveScores: (eventId) => f1.liveScores(eventId) });
      },
    };
    const leagues: EnabledLeague[] = [];
    for (const league of options.leagues) {
      const reader = Object.hasOwn(readers, league.code) ? readers[league.code] : undefined;
      if (reader === undefined) {
        options.logger?.error(
          { action: 'balldontlie.league.noReader', providerLeagueCode: league.code, sport: league.sport },
          'A BALLDONTLIE league row names a league the adapter has no reader for; it is not read',
        );
        continue;
      }
      leagues.push({ code: league.code, sport: league.sport, name: league.name, reader: reader() });
    }
    this.leagues = leagues;
  }

  /** Whether one of the leagues it reads has this code: an enabled league row it has a reader for. */
  servesLeague(providerLeagueCode: string): boolean {
    return this.leagues.some((league) => league.code === providerLeagueCode);
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
   * The events of the one league the code names, starting inside `dateRange`, each stamped with
   * the code. A code that names no enabled league of the sport throws `ProviderLeagueUnknownError`
   * and reads nothing (#2005); a refusal of the league by the plan throws
   * `ProviderLeagueRefusedError` (#1797).
   */
  async getUpcomingEvents(sport: Sport, dateRange: DateRange | undefined, options: ProviderEventListOptions): Promise<SportEvent[]> {
    const code = options.providerLeagueCode;
    const league = this.leagues.find((each) => each.code === code && each.sport === sport);
    if (league === undefined) throw new ProviderLeagueUnknownError(this.providerName, code);
    try {
      const events = await league.reader.events(dateRange, seasonOf(options.providerSeasonId));
      return events.map((event) => ({ ...event, providerLeagueCode: league.code }));
    } catch (error) {
      if (isPlanRefusal(error)) throw new ProviderLeagueRefusedError(this.providerName, league.name, error.status, { cause: error });
      throw error;
    }
  }

  /**
   * The event with its field, from the enabled league whose reader knows the id; null when no
   * enabled league does, or when the vendor has no such event. Nothing is read for an id no
   * enabled league knows (#2005).
   */
  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    const event = this.eventReads(eventId);
    return event === null ? null : event.details();
  }

  /** Every active PGA TOUR golfer, or every team of each of the sport's enabled leagues; none for a sport the adapter does not cover. */
  async getParticipants(sport: Sport): Promise<ProviderParticipant[]> {
    return this.eachLeague(sport, this.leagues.filter((league) => league.sport === sport), (league) => league.reader.participants());
  }

  /**
   * One league's roster for a season (#2025): the league the code names, of the sport; none for a
   * league whose roster the adapter does not read. A code that names no enabled league of the sport
   * throws `ProviderLeagueUnknownError` and reads nothing; a refusal by the plan throws
   * `ProviderLeagueRefusedError`.
   */
  async getRoster(sport: Sport, options: ProviderEventListOptions): Promise<ProviderRosterPlayer[]> {
    const code = options.providerLeagueCode;
    const league = this.leagues.find((each) => each.code === code && each.sport === sport);
    if (league === undefined) throw new ProviderLeagueUnknownError(this.providerName, code);
    if (league.reader.roster === undefined) return [];
    try {
      return await league.reader.roster(seasonOf(options.providerSeasonId));
    } catch (error) {
      if (isPlanRefusal(error)) throw new ProviderLeagueRefusedError(this.providerName, league.name, error.status, { cause: error });
      throw error;
    }
  }

  /**
   * The event's scores, from the enabled league whose reader knows the id: a game league's games in
   * the GAME category, or every started round of every golfer in a stroke-play tournament. An id no
   * enabled league knows, a tournament id the vendor does not know, or a tournament of another
   * format fails the sync rather than returning nothing.
   */
  async getLiveScores(eventId: string): Promise<LiveScoreResult> {
    const event = this.eventReads(eventId);
    if (event === null) throw new Error(`BALLDONTLIE reads no enabled league with an event ${eventId}.`);
    return event.liveScores();
  }

  /** The reads of the event an id names, from the first enabled league that knows it. */
  private eventReads(eventId: string): LeagueEventReads | null {
    for (const league of this.leagues) {
      const event = league.reader.event(eventId);
      if (event !== null) return event;
    }
    return null;
  }

  /**
   * Each of a sport's leagues' teams read on its own (#1797), together. A league whose read is
   * refused or fails is left out and logged (`balldontlie.league.unavailable`), so one league's
   * plan or outage never empties its neighbours' lists; when every league fails, the first
   * failure is thrown, as a one-league sport's always is. A league the provider rate limits is
   * never left out: its refusal is thrown, so the job is deferred rather than syncing a partial list.
   */
  private async eachLeague<Item>(sport: Sport, leagues: readonly EnabledLeague[], read: (league: EnabledLeague) => Promise<Item[]>): Promise<Item[]> {
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
          league: league.name,
          providerLeagueCode: league.code,
          read: 'participants',
          refused: isPlanRefusal(reason),
          status: reason instanceof BalldontlieRequestError ? reason.status : null,
          path: reason instanceof BalldontlieRequestError ? reason.path : null,
          error: errorMessage(reason),
        },
        'Left a league out of the sport\'s participants: its read was refused or failed',
      );
    }
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  /**
   * PGA TOUR tournaments starting inside `dateRange` (every season when it is open-ended or
   * absent). A tournament whose lifecycle the vendor marks `unknown` is left out: it cannot be
   * shown with an honest status.
   */
  private async pgaTournaments(dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    const tournaments = await this.listTournaments(season === undefined ? seasonsFor(dateRange) : [season]);
    return tournaments
      .filter(isClassifiedTournament)
      .map((tournament) => toSportEvent(tournament))
      .filter((event) => !dateRange
        || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** A tournament with its field and each golfer's world ranking; null when the vendor has no such tournament. */
  private async tournamentDetails(eventId: string): Promise<SportEventDetail | null> {
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
    return { ...toSportEvent(tournament), participants };
  }

  /** Every started round of every golfer in a stroke-play tournament. */
  private async tournamentScores(eventId: string): Promise<LiveScoreResult> {
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
    return { category: 'GOLF', externalEventId: eventId, rounds: toGolfRoundUpdates(tournament, results), final: isTournamentFinal(tournament) };
  }

  private async pgaPlayers(): Promise<ProviderParticipant[]> {
    const players = await this.client.getAllPages(
      '/pga/v1/players',
      { active: true },
      pgaPlayerListSchema,
    );
    return players.map(toTourParticipant);
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
/** A BALLDONTLIE season id: the four-digit year the season is numbered by. */
const SEASON_ID_PATTERN = /^\d{4}$/;

/**
 * The vendor season a Season's provider id names (#2003); none when no id was given. An id that
 * is not a vendor season number throws, since reading a guessed season would sync the wrong one.
 */
function seasonOf(providerSeasonId: string | undefined): number | undefined {
  if (providerSeasonId === undefined) return undefined;
  if (!SEASON_ID_PATTERN.test(providerSeasonId)) {
    throw new Error(`BALLDONTLIE has no season with the id "${providerSeasonId}"`);
  }
  return Number(providerSeasonId);
}

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
