/**
 * The NBA's playoffs from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's NBA shapes, and the two reads behind them. Each
 * round is a best of seven, one match of the bracket whose games' winners the GAME writer counts
 * (#1545). The games and teams endpoints name no paid tier in the vendor's document.
 */

import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import { NBA_PLAYOFFS_SEASON_TYPE, nbaGameListSchema, nbaTeamListSchema, type NbaGame, type NbaTeam } from './nba-contract';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from './series-playoffs';
import type { PlayoffsSource } from './series-playoffs-reader';

export const NBA_PLAYOFFS: PlayoffsLeague = {
  key: 'nba',
  tour: 'NBA',
  sport: Sport.BASKETBALL,
  eventName: 'NBA Playoffs',
  finalSeriesLength: 7,
  // The 2025 season opens in October 2025; its playoffs run from April into June 2026.
  playoffYearOffset: 1,
  // September, ahead of October's opening night.
  seasonRolloverMonth: 8,
};

const GAMES_PATH = '/nba/v1/games';
const TEAMS_PATH = '/nba/v1/teams';

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

export function toNbaPlayoffGame(game: NbaGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  // A game's tip-off, or its day where the league has not set the time yet.
  const start = game.datetime ?? required(game.date, GAMES_PATH, row, 'date');
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    start: Date.parse(start),
    home: toNbaPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toNbaPlayoffTeam(required(game.visitor_team, GAMES_PATH, row, 'visitor_team'), GAMES_PATH),
    state: game.status_state,
    homeScore: game.home_team_score ?? null,
    awayScore: game.visitor_team_score ?? null,
  };
}

/** The NBA's two reads: a season's playoff games (never the play-in), and every team. */
export function nbaPlayoffsSource(client: BalldontlieClient): PlayoffsSource {
  return {
    league: NBA_PLAYOFFS,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { 'seasons[]': [season], season_type: NBA_PLAYOFFS_SEASON_TYPE }, nbaGameListSchema);
      return games.map(toNbaPlayoffGame);
    },
    async teams() {
      const page = await client.get(TEAMS_PATH, {}, nbaTeamListSchema);
      return page.data.map((team) => toNbaPlayoffTeam(team, TEAMS_PATH));
    },
  };
}
