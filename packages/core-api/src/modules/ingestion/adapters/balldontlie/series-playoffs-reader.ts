/**
 * The reads of a best-of-series playoffs (#1496), shared by every league whose playoffs are
 * series: each season's postseason as an event, its teams, every team of the league, and the
 * postseason's game scores. A league supplies its two reads, already normalized; this does the
 * rest through `series-playoffs.ts`.
 *
 * A postseason's scores are every one of its games on each sync, never only the latest: the GAME
 * writer counts a series' wins from the games it is handed (#1545).
 */

import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { GameProgress, PROGRESS_BY_STATE } from './competition-status';
import type { DateRange, ProviderParticipant, SportEvent, SportEventDetail } from '../../core/provider-interface';
import {
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
  /** Every postseason game of a season. */
  games(season: number): Promise<PlayoffGame[]>;
  /** Every team of the league. */
  teams(): Promise<PlayoffTeam[]>;
  /** The lines of the players who played these games (#1497). */
  statLines(gameIds: readonly number[]): Promise<PlayoffStatLine[]>;
  /** These teams' active players, of at least one team (#1497). */
  players(teamIds: readonly number[]): Promise<PlayoffPlayer[]>;
}

/** A range spanning more seasons than this reads the current and next season instead of every one. */
const MAX_SEASONS_READ = 3;

export class PlayoffsReader {
  constructor(
    private readonly source: PlayoffsSource,
    private readonly now: () => number,
  ) {}

  /**
   * The playoffs whose first game starts inside `dateRange`: the seasons whose playoffs fall in
   * one of its years. Without a range, or with one too wide to walk, it reads the season under way
   * and the next. A season whose postseason has no game scheduled yet lists nothing.
   */
  async upcomingEvents(dateRange?: DateRange): Promise<SportEvent[]> {
    const games: PlayoffGame[] = [];
    for (const season of this.seasonsFor(dateRange)) {
      games.push(...await this.source.games(season));
    }
    // Each season's playoffs, then each round it has reached, a round being a Clutch Card's event (#1497).
    const seasons = [...new Set(games.map((game) => game.season))];
    const rounds = seasons.flatMap((season) => toPlayoffRoundEvents(this.source.league, season, games.filter((game) => game.season === season)));
    return [...toPlayoffsEvents(this.source.league, games), ...rounds]
      .filter((event) => !dateRange || (event.startDate >= dateRange.from && event.startDate <= dateRange.to));
  }

  /** A season's playoffs with the teams in them; null when the vendor has no postseason game yet. */
  async eventDetails(season: number): Promise<SportEventDetail | null> {
    const games = await this.source.games(season);
    if (games.length === 0) return null;
    const participants = toPlayoffsFieldParticipants(this.source.league, games);
    return { ...toPlayoffsEvent(this.source.league, season, games, participants.length), participants };
  }

  /** Every team of the league. */
  async teams(): Promise<ProviderParticipant[]> {
    return (await this.source.teams()).map((team) => toPlayoffsTeamParticipant(this.source.league, team));
  }

  /** Every game of a season's postseason, with its teams, state and score. */
  async liveScores(season: number): Promise<LiveScoreResult> {
    const games = await this.source.games(season);
    return { category: 'GAME', externalEventId: playoffsScopeId(this.source.league, season), games: toPlayoffsGameScoreUpdates(this.source.league, games) };
  }

  /**
   * A round of a season's playoffs with its teams' active players, the stars a Clutch Card picks
   * from (#1497); null when no series of the round has a game yet.
   */
  async roundEventDetails(season: number, round: number): Promise<SportEventDetail | null> {
    const series = await this.roundSeries(season, round);
    if (series.length === 0) return null;
    const teamIds = [...new Set(series.flatMap((each) => [each.games[0].home.id, each.games[0].away.id]))];
    const participants = (await this.source.players(teamIds)).map((player) => toPlayoffPlayerParticipant(this.source.league, player));
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
    return playoffSeries(await this.source.games(season)).filter((each) => each.round === round);
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
