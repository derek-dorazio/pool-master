/**
 * The NBA's playoffs from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's NBA shapes, and the two reads behind them. Each
 * round is a best of seven, one match of the bracket whose games' winners the GAME writer counts
 * (#1545). The games and teams endpoints name no paid tier in the vendor's document. A round's
 * Clutch Card (#1497) reads the round's games' stat rows (`/nba/v1/stats`) and its teams' active
 * rosters, each scored by Triple Threat: points, rebounds and assists, all of which the vendor
 * reports.
 */

import { Sport, SportStat } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import {
  NBA_CONFERENCES,
  NBA_PLAYOFFS_SEASON_TYPE,
  nbaGameListSchema,
  nbaPlayerListSchema,
  nbaStatsListSchema,
  nbaTeamListSchema,
  type NbaGame,
  type NbaPlayer,
  type NbaStats,
  type NbaTeam,
} from './nba-contract';
import type { PlayoffPlayer, PlayoffStatLine } from './series-playoff-rounds';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from './series-playoffs';
import type { PlayoffRoundsSource } from './series-playoffs-reader';

export const NBA_PLAYOFFS: PlayoffsLeague = {
  key: 'nba',
  tour: 'NBA',
  sport: Sport.BASKETBALL,
  eventName: 'NBA Playoffs',
  rounds: [
    { name: 'NBA First Round', seriesLength: 7, seriesCount: 8 },
    { name: 'NBA Conference Semifinals', seriesLength: 7, seriesCount: 4 },
    { name: 'NBA Conference Finals', seriesLength: 7, seriesCount: 2 },
    { name: 'NBA Finals', seriesLength: 7, seriesCount: 1 },
  ],
  // The 2025 season opens in October 2025; its playoffs run from April into June 2026.
  playoffYearOffset: 1,
  // September, ahead of October's opening night.
  seasonRolloverMonth: 8,
};

const GAMES_PATH = '/nba/v1/games';
const TEAMS_PATH = '/nba/v1/teams';
const STATS_PATH = '/nba/v1/stats';
const ACTIVE_PLAYERS_PATH = '/nba/v1/players/active';

/** A field the document leaves optional but without which a row cannot be placed or scored. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  return value;
}

export function toNbaPlayoffTeam(team: NbaTeam, path: string): PlayoffTeam {
  const id = required(team.id, path, 'a team', 'id');
  return {
    id,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    metadata: { abbreviation: team.abbreviation, conference: team.conference, division: team.division },
  };
}

/** The league's current teams from the teams list, leaving out any franchise in no conference now. */
export function toNbaPlayoffTeams(teams: readonly NbaTeam[]): PlayoffTeam[] {
  return teams
    .filter((team) => team.conference !== undefined && NBA_CONFERENCES.includes(team.conference))
    .map((team) => toNbaPlayoffTeam(team, TEAMS_PATH));
}

export function toNbaPlayoffGame(game: NbaGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  // A game's tip-off, or its day where the league has not set the time yet. A day alone parses as
  // midnight UTC, so such a game sorts before that day's timed games. A day is enough for what reads
  // it: the event's first and last days, and which series starts last, the final starting days
  // after the last conference final.
  const start = game.datetime ?? required(game.date, GAMES_PATH, row, 'date');
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    postseason: required(game.postseason, GAMES_PATH, row, 'postseason'),
    start: Date.parse(start),
    home: toNbaPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toNbaPlayoffTeam(required(game.visitor_team, GAMES_PATH, row, 'visitor_team'), GAMES_PATH),
    state: game.status_state,
    homeScore: game.home_team_score ?? null,
    awayScore: game.visitor_team_score ?? null,
  };
}

/** A line's minutes say the player was on the floor: any minutes or seconds other than zero. */
function played(minutes: string | undefined): boolean {
  return minutes !== undefined && /[1-9]/.test(minutes);
}

/**
 * A stat row as the line Triple Threat scores (points, rebounds and assists), or null for a player
 * who did not play: the vendor lists a player who did not get in with zero or empty minutes, and
 * such a player has no line, as the loader's box scores have none.
 */
export function toNbaStatLine(row: NbaStats): PlayoffStatLine | null {
  if (!played(row.min)) return null;
  const player = required(row.player, STATS_PATH, 'a stat row', 'player');
  const playerId = required(player.id, STATS_PATH, 'a stat row\'s player', 'id');
  const label = `player ${String(playerId)}'s stat row`;
  return {
    gameId: required(required(row.game, STATS_PATH, label, 'game').id, STATS_PATH, label, 'game id'),
    playerId,
    stats: [
      { stat: SportStat.POINTS, value: required(row.pts, STATS_PATH, label, 'pts') },
      { stat: SportStat.REBOUNDS, value: required(row.reb, STATS_PATH, label, 'reb') },
      { stat: SportStat.ASSISTS, value: required(row.ast, STATS_PATH, label, 'ast') },
    ],
  };
}

export function toNbaPlayoffPlayer(player: NbaPlayer): PlayoffPlayer {
  const id = required(player.id, ACTIVE_PLAYERS_PATH, 'a player', 'id');
  const name = [player.first_name, player.last_name].filter((part) => part !== undefined && part !== '').join(' ');
  if (name === '') throw new BalldontlieContractError(ACTIVE_PLAYERS_PATH, [`player ${String(id)} has no first_name or last_name`]);
  return { id, name, metadata: { position: player.position, team: player.team?.full_name } };
}

/**
 * The NBA's reads: a season's playoff games (never the play-in), every team, the stat rows of some
 * games, and some teams' active rosters.
 */
export function nbaPlayoffsSource(client: BalldontlieClient): PlayoffRoundsSource {
  return {
    league: NBA_PLAYOFFS,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { 'seasons[]': [season], season_type: NBA_PLAYOFFS_SEASON_TYPE }, nbaGameListSchema);
      return games.map(toNbaPlayoffGame);
    },
    async teams() {
      const page = await client.get(TEAMS_PATH, {}, nbaTeamListSchema);
      return toNbaPlayoffTeams(page.data);
    },
    async statLines(gameIds) {
      if (gameIds.length === 0) return [];
      const rows = await client.getAllPages(STATS_PATH, { 'game_ids[]': gameIds }, nbaStatsListSchema);
      return rows.flatMap((row) => {
        const line = toNbaStatLine(row);
        return line === null ? [] : [line];
      });
    },
    async players(teamIds) {
      const players = await client.getAllPages(ACTIVE_PLAYERS_PATH, { 'team_ids[]': teamIds }, nbaPlayerListSchema);
      return players.map(toNbaPlayoffPlayer);
    },
  };
}
