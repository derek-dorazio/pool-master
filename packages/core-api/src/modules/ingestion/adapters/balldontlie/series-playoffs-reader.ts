/**
 * The reads of a best-of-series playoffs (#1496), shared by every league whose playoffs are
 * series: each season's postseason as an event, its teams, every team of the league, and the
 * postseason's game scores. A league supplies its reads, already normalized; this does the
 * rest through `series-playoffs.ts`.
 *
 * A postseason's scores are every one of its games on each sync, never only the latest: the GAME
 * writer counts a series' wins from the games it is handed (#1545).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { BalldontlieRequestError } from './balldontlie-client';
import { GameProgress, PROGRESS_BY_STATE } from './competition-status';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import {
  BracketShapeKind,
  playoffsScopeId,
  playoffsTeamExternalId,
  toPlayoffsEvent,
  toPlayoffsEvents,
  toPlayoffsFieldParticipants,
  toPlayoffsGameScoreUpdates,
  toPlayoffsTeamParticipant,
  type PlayoffGame,
  type PlayoffsLeague,
  type PlayoffTeam,
} from './series-playoffs';
import { hasWholeFirstRound, toPlayoffsBracket, toPlayoffSeriesGames, type PlayoffSeedRanks } from './series-playoff-bracket';
import {
  playoffRoundScopeId,
  playoffSeries,
  toPlayoffPlayerParticipant,
  toPlayoffRoundBoxScores,
  toPlayoffRoundEvent,
  toPlayoffRoundEvents,
  type PlayoffPlayer,
  type PlayoffStatLine,
} from './series-playoff-rounds';

/** A league's own reads, normalized. */
export interface PlayoffsSource {
  league: PlayoffsLeague;
  /**
   * A season's postseason games as the league's games endpoint returns them for its postseason
   * query. The reader keeps only the games marked as that season's postseason, so an endpoint
   * that ignores a filter cannot pass a regular season or another season off as the playoffs.
   */
  games(season: number): Promise<PlayoffGame[]>;
  /** Every team of the league. */
  teams(): Promise<PlayoffTeam[]>;
  /**
   * Each team's seed rank within its group for a season (`series-playoff-bracket.ts`), for a league
   * with a bracket shape; a team the standings do not rank is left out.
   */
  seedRanks?(season: number): Promise<PlayoffSeedRanks>;
}

/** A league whose playoff rounds are Clutch Card events (#1497): its box scores and rosters too. */
export interface PlayoffRoundsSource extends PlayoffsSource {
  /** The lines of the players who played these games. */
  statLines(gameIds: readonly number[]): Promise<PlayoffStatLine[]>;
  /** These teams' active players, of at least one team. */
  players(teamIds: readonly number[]): Promise<PlayoffPlayer[]>;
}

/** A range spanning more seasons than this reads the current and next season instead of every one. */
const MAX_SEASONS_READ = 3;

/**
 * A league's playoffs as one event a season. A league whose rounds are Clutch Card events reads
 * them through `PlayoffRoundsReader`; one without box scores yet (the NHL's) lists no round, since
 * it could not answer for one.
 */
export class PlayoffsReader {
  constructor(
    protected readonly source: PlayoffsSource,
    private readonly now: () => number,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * The playoffs whose first game starts inside `dateRange`: the seasons whose playoffs fall in
   * one of its years. Without a range, or with one too wide to walk, it reads the season under way
   * and the next. A season whose postseason has no game scheduled yet lists nothing.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const games: PlayoffGame[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      games.push(...await this.postseasonGames(season));
    }
    return [...toPlayoffsEvents(this.source.league, games), ...this.roundEvents(games)]
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /**
   * A season's playoffs with the teams in them; null when the vendor has no postseason game yet. A
   * league with a bracket shape also gives each series as one game, and its whole bracket once the
   * seeds place the first round.
   */
  async eventDetails(season: number): Promise<SportEventDetail | null> {
    const games = await this.postseasonGames(season);
    if (games.length === 0) return null;
    const { league } = this.source;
    const participants = toPlayoffsFieldParticipants(league, games);
    const event = { ...toPlayoffsEvent(league, season, games, participants.length), participants };
    // A league whose bracket is not built from its seeds gives no games: an admin builds its
    // bracket, and series games alone would not keep one.
    if (league.bracket === undefined || this.source.seedRanks === undefined) return event;
    // The standings are read only once the whole first round is out, when they can seed it.
    const ranks = hasWholeFirstRound(league, games) ? await this.seedRanks(this.source.seedRanks.bind(this.source), season) : null;
    // A bye bracket's top seeds play no first-round game, so they come from the league's teams.
    const teams = ranks !== null && ranks.size > 0 && league.bracket.kind === BracketShapeKind.BYES ? await this.source.teams() : [];
    const bracket = ranks === null ? null : toPlayoffsBracket(league, games, ranks, teams);
    const named = new Set(bracket?.flatMap((match) => [match.homeTeamExternalId, match.awayTeamExternalId]));
    const inField = new Set(participants.map((participant) => participant.externalId));
    const byes = teams.filter((team) => named.has(playoffsTeamExternalId(league, team.id)) && !inField.has(playoffsTeamExternalId(league, team.id)));
    const field = [...participants, ...byes.map((team) => toPlayoffsTeamParticipant(league, team))];
    return {
      ...event,
      participants: field,
      participantCount: field.length,
      rounds: league.rounds.length,
      games: toPlayoffSeriesGames(league, games, bracket),
      ...(bracket !== null && { bracket }),
    };
  }

  /**
   * The season's seed ranks, or null when the plan does not include the standings (a 401 or 403):
   * the bracket is the one thing that needs them, and an admin builds it without, so the field
   * and the series games still load. Any other failure is thrown, so an outage still shows.
   */
  private async seedRanks(read: (season: number) => Promise<PlayoffSeedRanks>, season: number): Promise<PlayoffSeedRanks | null> {
    try {
      return await read(season);
    } catch (error) {
      if (!(error instanceof BalldontlieRequestError) || (error.status !== 401 && error.status !== 403)) throw error;
      this.logger?.warn(
        { action: 'balldontlie.playoffs.standingsRefused', league: this.source.league.key, season, path: error.path, status: error.status },
        'Read a series playoffs without its standings, which the plan does not include; an admin builds its bracket',
      );
      return null;
    }
  }

  /** Every team of the league. */
  async teams(): Promise<ProviderParticipant[]> {
    return (await this.source.teams()).map((team) => toPlayoffsTeamParticipant(this.source.league, team));
  }

  /** Every game of a season's postseason, with its teams, state and score. */
  async liveScores(season: number): Promise<LiveScoreResult> {
    const games = await this.postseasonGames(season);
    return { category: 'GAME', externalEventId: playoffsScopeId(this.source.league, season), games: toPlayoffsGameScoreUpdates(this.source.league, games) };
  }

  /** The rounds the games have reached as events of their own: none for a league without round reads. */
  protected roundEvents(_games: readonly PlayoffGame[]): SportEvent[] {
    return [];
  }

  /** The season's games the vendor marks as its postseason, whatever the query's filters did. */
  protected async postseasonGames(season: number): Promise<PlayoffGame[]> {
    return (await this.source.games(season)).filter((game) => game.postseason && game.season === season);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    const { playoffYearOffset, seasonRolloverMonth } = this.source.league;
    if (dateRange) {
      const first = dateRange.from.getUTCFullYear() - playoffYearOffset;
      const count = dateRange.to.getUTCFullYear() - playoffYearOffset - first + 1;
      if (count <= MAX_SEASONS_READ) return Array.from({ length: count }, (_, index) => first + index);
    }
    const today = new Date(this.now());
    const current = today.getUTCMonth() >= seasonRolloverMonth ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    return [current, current + 1];
  }
}

/** A league's playoffs and each round of them as a Clutch Card's event (#1497). */
export class PlayoffRoundsReader extends PlayoffsReader {
  constructor(
    protected override readonly source: PlayoffRoundsSource,
    now: () => number,
    logger?: FastifyBaseLogger,
  ) {
    super(source, now, logger);
  }

  /** Each season's rounds the games have reached. */
  protected override roundEvents(games: readonly PlayoffGame[]): SportEvent[] {
    const seasons = [...new Set(games.map((game) => game.season))];
    return seasons.flatMap((season) => toPlayoffRoundEvents(this.source.league, season, games.filter((game) => game.season === season)));
  }

  /**
   * A round of a season's playoffs with its teams' active players, the stars a Clutch Card picks
   * from (#1497); null when no series of the round has a game yet.
   */
  async roundEventDetails(season: number, round: number): Promise<SportEventDetail | null> {
    const series = await this.roundSeries(season, round);
    if (series.length === 0) return null;
    const teamIds = [...new Set(series.flatMap((each) => [each.games[0].home.id, each.games[0].away.id]))];
    const participants = (await this.source.players(teamIds)).map((player) => toPlayoffPlayerParticipant(this.source.league, round, player));
    return { ...toPlayoffRoundEvent(this.source.league, season, round, series, participants.length), participants };
  }

  /**
   * A round's box scores in the STAT_LINE category (#1497): every game of its series, numbered
   * within its series, with the lines of the players who played it. One stats read for the round.
   */
  async roundLiveScores(season: number, round: number): Promise<LiveScoreResult> {
    const series = await this.roundSeries(season, round);
    const underWay = series.flatMap((each) => each.games).filter((game) => PROGRESS_BY_STATE[game.state] === GameProgress.LIVE || PROGRESS_BY_STATE[game.state] === GameProgress.FINAL);
    const lines = await this.source.statLines(underWay.map((game) => game.id));
    return {
      category: 'STAT_LINE',
      externalEventId: playoffRoundScopeId(this.source.league, season, round),
      games: toPlayoffRoundBoxScores(this.source.league, series, lines),
    };
  }

  private async roundSeries(season: number, round: number) {
    return playoffSeries(await this.postseasonGames(season)).filter((each) => each.round === round);
  }
}
