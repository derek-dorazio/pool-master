/**
 * The WNBA's playoffs from BALLDONTLIE (#1496): the league as the shared series-playoffs mapping
 * needs it, the normalizers from the vendor's WNBA shapes, and the two reads behind them. Eight
 * teams play a best-of-three First Round, best-of-five Semifinals and best-of-seven WNBA Finals;
 * each series is one match of the bracket whose games' winners the GAME writer counts (#1545).
 * The games and teams endpoints name no paid tier in the vendor's document.
 *
 * A WNBA season is the calendar year, and its playoffs are played in September and October.
 * The games endpoint filters by season but documents no value of its `season_type` filter and
 * no `postseason` filter, so a season's games are all read (about three pages) and the shared
 * reader keeps the playoffs by each game's `postseason` flag.
 */

import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieContractError, type BalldontlieClient } from './balldontlie-client';
import { wnbaGameListSchema, wnbaTeamListSchema, type WnbaGame, type WnbaTeam } from './wnba-contract';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from './series-playoffs';
import type { PlayoffsSource } from './series-playoffs-reader';

export const WNBA_PLAYOFFS: PlayoffsLeague = {
  key: 'wnba',
  tour: 'WNBA',
  sport: Sport.BASKETBALL,
  eventName: 'WNBA Playoffs',
  // Each round's name is the tour a future WNBA Clutch Card league on that round would match.
  rounds: [
    { name: 'WNBA First Round', seriesLength: 3, seriesCount: 4 },
    { name: 'WNBA Semifinals', seriesLength: 5, seriesCount: 2 },
    { name: 'WNBA Finals', seriesLength: 7, seriesCount: 1 },
  ],
  // The 2026 season's playoffs are played in September and October 2026.
  playoffYearOffset: 0,
  // May, when the new season tips off.
  seasonRolloverMonth: 4,
};

const GAMES_PATH = '/wnba/v1/games';
const TEAMS_PATH = '/wnba/v1/teams';

/** A field the document leaves optional but without which a row cannot be placed or scored. */
function required<Value>(value: Value | undefined, path: string, row: string, field: string): Value {
  if (value === undefined) throw new BalldontlieContractError(path, [`${row} has no ${field}`]);
  return value;
}

export function toWnbaPlayoffTeam(team: WnbaTeam, path: string): PlayoffTeam {
  const id = required(team.id, path, 'a team', 'id');
  return {
    id,
    name: required(team.full_name, path, `team ${String(id)}`, 'full_name'),
    metadata: { abbreviation: team.abbreviation, conference: team.conference },
  };
}

export function toWnbaPlayoffGame(game: WnbaGame): PlayoffGame {
  const row = `game ${game.id === undefined ? '(no id)' : String(game.id)}`;
  return {
    id: required(game.id, GAMES_PATH, row, 'id'),
    season: required(game.season, GAMES_PATH, row, 'season'),
    // A game that does not say whether it is a playoff game cannot be placed.
    postseason: required(game.postseason, GAMES_PATH, row, 'postseason'),
    start: Date.parse(required(game.date, GAMES_PATH, row, 'date')),
    home: toWnbaPlayoffTeam(required(game.home_team, GAMES_PATH, row, 'home_team'), GAMES_PATH),
    away: toWnbaPlayoffTeam(required(game.visitor_team, GAMES_PATH, row, 'visitor_team'), GAMES_PATH),
    state: game.status_state,
    homeScore: game.home_score ?? null,
    awayScore: game.away_score ?? null,
  };
}

/**
 * Whether a team is a current franchise. The document gives a team's conference as any string
 * and lists none of its values, so a team with none, as a folded franchise the vendor keeps may
 * have, is left out: a team in no conference plays in no playoffs.
 */
export function isWnbaFranchise(team: WnbaTeam): boolean {
  return Boolean(team.conference);
}

/** The WNBA's two reads: a season's games, of which the reader keeps the playoffs, and every current franchise. */
export function wnbaPlayoffsSource(client: BalldontlieClient): PlayoffsSource {
  return {
    league: WNBA_PLAYOFFS,
    async games(season) {
      const games = await client.getAllPages(GAMES_PATH, { 'seasons[]': [season] }, wnbaGameListSchema);
      return games.map(toWnbaPlayoffGame);
    },
    async teams() {
      const page = await client.get(TEAMS_PATH, {}, wnbaTeamListSchema);
      return page.data.filter(isWnbaFranchise).map((team) => toWnbaPlayoffTeam(team, TEAMS_PATH));
    },
  };
}
