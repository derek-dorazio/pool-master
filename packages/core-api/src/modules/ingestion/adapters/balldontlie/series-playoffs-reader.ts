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
import type { DateRange, ProviderBracketMatch, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import {
  BracketShapeKind,
  playoffsScopeId,
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
import { participantFeedId } from './participant-feed-id';

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

/** A range spanning more seasons than this reads none. */
const MAX_SEASONS_READ = 3;

/** A league's playoffs as one event a season. */
export class PlayoffsReader {
  constructor(
    private readonly source: PlayoffsSource,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * One season's playoffs, when `season` names it (the events sync asks for a Season by its id,
   * #2003); otherwise the playoffs whose first game starts inside `dateRange`: the seasons whose
   * playoffs fall in one of its years. With neither, or a range too wide to walk, it reads none. A
   * season whose postseason has no game scheduled yet lists nothing.
   */
  async upcomingEvents(dateRange?: DateRange, season?: number): Promise<SportEvent[]> {
    const games: PlayoffGame[] = [];
    for (const each of season === undefined ? this.seasonsFor(dateRange) : [season]) {
      games.push(...await this.postseasonGames(each));
    }
    return toPlayoffsEvents(this.source.league, games)
      .filter((event) => season !== undefined || !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
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
    const event = { ...toPlayoffsEvent(league, season, games), participants };
    // A league whose bracket is not built from its seeds gives no games: an admin builds its
    // bracket, and series games alone would not keep one.
    if (league.bracket === undefined || this.source.seedRanks === undefined) return event;
    const readRanks = this.source.seedRanks.bind(this.source);
    // The standings are read only once the whole first round is out, when they can seed it.
    const ranks = hasWholeFirstRound(league, games) ? await this.unlessRefused(season, 'standings', () => readRanks(season)) : null;
    // A bye bracket's top seeds play no first-round game, so they come from the league's teams.
    const needsTeams = ranks !== null && ranks.size > 0 && league.bracket.kind === BracketShapeKind.BYES;
    const byeTeams = needsTeams ? await this.unlessRefused(season, 'teams', () => this.source.teams()) : [];
    const teams = byeTeams ?? [];
    let bracket: ProviderBracketMatch[] | null = null;
    // A refused read has said why already; anything else that leaves the bracket out says so here.
    if (ranks !== null && byeTeams !== null) {
      bracket = toPlayoffsBracket(league, games, ranks, teams);
      if (bracket === null) {
        this.logger?.warn(
          { action: 'balldontlie.playoffs.bracketUnplaced', league: league.key, season, rankedTeams: ranks.size, teams: teams.length },
          'The standings did not place a series playoffs\' whole first round, so it loads without a bracket; an admin builds it',
        );
      }
    }
    const named = new Set(bracket?.flatMap((match) => [match.homeTeamExternalId, match.awayTeamExternalId]));
    const inField = new Set(participants.map((participant) => participant.externalId));
    const byes = teams.filter((team) => named.has(participantFeedId(team.id)) && !inField.has(participantFeedId(team.id)));
    const field = [...participants, ...byes.map((team) => toPlayoffsTeamParticipant(league, team))];
    return {
      ...event,
      participants: field,
      rounds: league.rounds.length,
      games: toPlayoffSeriesGames(games, bracket),
      ...(bracket !== null && { bracket }),
    };
  }

  /**
   * A read the bracket needs (the standings, or a bye bracket's teams), or null when the plan does
   * not include it (a 401 or 403): the bracket is the one thing that needs it, and an admin builds
   * it without, so the field and the series games still load. Any other failure is thrown, so an
   * outage still shows.
   */
  private async unlessRefused<Value>(season: number, what: 'standings' | 'teams', read: () => Promise<Value>): Promise<Value | null> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof BalldontlieRequestError) || (error.status !== 401 && error.status !== 403)) throw error;
      this.logger?.warn(
        { action: `balldontlie.playoffs.${what}Refused`, league: this.source.league.key, season, path: error.path, status: error.status },
        `Read a series playoffs without its ${what}, which the plan does not include; an admin builds its bracket`,
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
    return { category: 'GAME', externalEventId: playoffsScopeId(this.source.league, season), games: toPlayoffsGameScoreUpdates(games) };
  }

  /** The season's games the vendor marks as its postseason, whatever the query's filters did. */
  private async postseasonGames(season: number): Promise<PlayoffGame[]> {
    return (await this.source.games(season)).filter((game) => game.postseason && game.season === season);
  }

  private seasonsFor(dateRange?: DateRange): number[] {
    if (!dateRange) return [];
    const { playoffYearOffset } = this.source.league;
    const first = dateRange.from.getUTCFullYear() - playoffYearOffset;
    const count = dateRange.to.getUTCFullYear() - playoffYearOffset - first + 1;
    return count <= MAX_SEASONS_READ ? Array.from({ length: count }, (_, index) => first + index) : [];
  }
}

