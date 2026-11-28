/**
 * The BALLDONTLIE box score responses (#2026), as far as PoolMaster reads them: each league's
 * per-game player stats endpoint, the ids that say whose line in which game a row is, and the
 * vendor fields each `SportStat` is read from.
 *
 * Built the way the other `*-contract.ts` files are: each schema names only the fields the adapter
 * uses, with the type the vendor's published OpenAPI document gives them, and lets every other
 * field through. The document requires none of them, so every field is read as optional, and a
 * stat the vendor leaves out or sends as null has no stat row. Every endpoint here needs a paid
 * plan; the free key answers 401, which the adapter reports as the plan refusing the league.
 *
 * A league's stats are the vendor's own words for its box score columns (`pts`, `bb`), so they are
 * parsed here as data (rules/domain-model-conventions-rules.md §17, *Provider keys live only in
 * ProviderMapping tables*: the provider's own words are parsed in its adapter). Which stats a
 * composite counts is the model's (#2027).
 *
 * `tests/unit/core-api/balldontlie/box-score-contract.test.ts` holds every field here against the
 * vendored copies of the documents.
 */

import { z } from 'zod';
import { SportStat } from '@poolmaster/shared/domain';
import { balldontliePaginationSchema } from './balldontlie-client';

/** A whole-number stat column, nullable where the vendor sends null for a stat not kept. */
const statColumn = z.number().int().nullable().optional();

/** A player as a box score row nests them: the id, and the name a finding about them shows. */
const boxScorePlayerSchema = z.object({
  id: z.number().int().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
});

/** A game as a box score row nests it: only its id is read. */
const boxScoreGameSchema = z.object({
  id: z.number().int().optional(),
});

/** Each stat the adapter reads, by the vendor's column name. */
type StatColumns = Readonly<Partial<Record<SportStat, string>>>;

/** American football's columns, the NFL's and college football's alike. */
const FOOTBALL_COLUMNS = {
  [SportStat.PASSING_TOUCHDOWNS]: 'passing_touchdowns',
  [SportStat.RUSHING_TOUCHDOWNS]: 'rushing_touchdowns',
  [SportStat.RECEIVING_TOUCHDOWNS]: 'receiving_touchdowns',
  [SportStat.RECEPTIONS]: 'receptions',
  [SportStat.PASSING_YARDS]: 'passing_yards',
  [SportStat.RUSHING_YARDS]: 'rushing_yards',
  [SportStat.RECEIVING_YARDS]: 'receiving_yards',
} as const satisfies StatColumns;

/** Basketball's columns, every basketball league's alike. */
const BASKETBALL_COLUMNS = {
  [SportStat.POINTS]: 'pts',
  [SportStat.REBOUNDS]: 'reb',
  [SportStat.ASSISTS]: 'ast',
} as const satisfies StatColumns;

/** The NHL's box score columns. */
const HOCKEY_COLUMNS = {
  [SportStat.GOALS]: 'goals',
  [SportStat.ASSISTS]: 'assists',
  [SportStat.SHOTS_ON_GOAL]: 'shots_on_goal',
} as const satisfies StatColumns;

/** MLB's batting columns. */
const BASEBALL_COLUMNS = {
  [SportStat.TOTAL_BASES]: 'total_bases',
  [SportStat.RUNS]: 'runs',
  [SportStat.RUNS_BATTED_IN]: 'rbi',
  [SportStat.WALKS]: 'bb',
  [SportStat.STOLEN_BASES]: 'stolen_bases',
} as const satisfies StatColumns;

/** Soccer's columns, the Premier League's and the World Cup's alike. */
const SOCCER_COLUMNS = {
  [SportStat.GOALS]: 'goals',
  [SportStat.ASSISTS]: 'assists',
  [SportStat.SHOTS_ON_TARGET]: 'shots_on_target',
} as const satisfies StatColumns;

/** An object schema of every column, each a whole-number stat. */
function statShape<C extends StatColumns>(columns: C): { [K in C[keyof C] & string]: typeof statColumn } {
  return Object.fromEntries(Object.values(columns).map((column) => [column, statColumn])) as { [K in C[keyof C] & string]: typeof statColumn };
}

/** A row that nests its player and its game, as most leagues' stats endpoints send them. */
function nestedRowSchema<C extends StatColumns>(columns: C) {
  return z.object({ player: boxScorePlayerSchema.optional(), game: boxScoreGameSchema.optional(), ...statShape(columns) });
}

const footballStatRowSchema = nestedRowSchema(FOOTBALL_COLUMNS);
const basketballStatRowSchema = nestedRowSchema(BASKETBALL_COLUMNS);
const hockeyStatRowSchema = nestedRowSchema(HOCKEY_COLUMNS);
/** MLB nests the player but names the game by `game_id`. */
const baseballStatRowSchema = z.object({ player: boxScorePlayerSchema.optional(), game_id: z.number().int().optional(), ...statShape(BASEBALL_COLUMNS) });
/** Soccer names the player and the match by id, with no name. */
const soccerStatRowSchema = z.object({ player_id: z.number().int().optional(), match_id: z.number().int().optional(), ...statShape(SOCCER_COLUMNS) });

function listSchema<Row extends z.ZodType>(row: Row) {
  return z.object({ data: z.array(row), meta: balldontliePaginationSchema.optional() });
}

/** Where a box score row's ids are, whichever shape it takes. */
export interface BoxScoreRowIds {
  gameId: number | undefined;
  playerId: number | undefined;
  playerName: string | null;
}

/** One league's per-game player stats endpoint. */
export interface BoxScoreEndpoint {
  path: string;
  /** The query parameter that takes the games' ids, as the endpoint names it. */
  gameIdsParam: string;
  schema: z.ZodType<{ data: Array<Record<string, unknown>>; meta?: { next_cursor?: number | null } }>;
  /** One row of the list, as `schema` reads it: the fields the contract test holds to the vendor's document. */
  rowSchema: z.ZodObject;
  columns: StatColumns;
  ids(row: Record<string, unknown>): BoxScoreRowIds;
}

type BoxScorePlayer = z.infer<typeof boxScorePlayerSchema>;

function playerNameOf(player: BoxScorePlayer | undefined): string | null {
  const name = [player?.first_name, player?.last_name].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
  return name.length > 0 ? name : null;
}

function nestedIds(row: Record<string, unknown>): BoxScoreRowIds {
  const { player, game } = row as { player?: BoxScorePlayer; game?: { id?: number } };
  return { gameId: game?.id, playerId: player?.id, playerName: playerNameOf(player) };
}

function nestedEndpoint(path: string, gameIdsParam: string, columns: StatColumns, row: z.ZodObject): BoxScoreEndpoint {
  return { path, gameIdsParam, schema: listSchema(row), rowSchema: row, columns, ids: nestedIds };
}

/**
 * Each league's box score endpoint, by the vendor's league code: the vendor's own paths, as the
 * readers' are. A league with none here (PGA TOUR, Formula 1) has no per-game player stats.
 */
export const BOX_SCORE_ENDPOINTS: Readonly<Record<string, BoxScoreEndpoint>> = {
  nfl: nestedEndpoint('/nfl/v1/stats', 'game_ids[]', FOOTBALL_COLUMNS, footballStatRowSchema),
  ncaaf: nestedEndpoint('/ncaaf/v1/player_stats', 'game_ids[]', FOOTBALL_COLUMNS, footballStatRowSchema),
  nba: nestedEndpoint('/nba/v1/stats', 'game_ids[]', BASKETBALL_COLUMNS, basketballStatRowSchema),
  wnba: nestedEndpoint('/wnba/v1/player_stats', 'game_ids[]', BASKETBALL_COLUMNS, basketballStatRowSchema),
  ncaab: nestedEndpoint('/ncaab/v1/player_stats', 'game_ids[]', BASKETBALL_COLUMNS, basketballStatRowSchema),
  ncaaw: nestedEndpoint('/ncaaw/v1/player_stats', 'game_ids[]', BASKETBALL_COLUMNS, basketballStatRowSchema),
  nhl: nestedEndpoint('/nhl/v1/box_scores', 'game_ids', HOCKEY_COLUMNS, hockeyStatRowSchema),
  mlb: {
    path: '/mlb/v1/stats',
    gameIdsParam: 'game_ids[]',
    schema: listSchema(baseballStatRowSchema),
    rowSchema: baseballStatRowSchema,
    columns: BASEBALL_COLUMNS,
    ids: (row) => {
      const { player, game_id: gameId } = row as { player?: BoxScorePlayer; game_id?: number };
      return { gameId, playerId: player?.id, playerName: playerNameOf(player) };
    },
  },
  epl: soccerEndpoint('/epl/v2/player_match_stats', 'match_ids'),
  worldcup: soccerEndpoint('/fifa/worldcup/v1/player_match_stats', 'match_ids[]'),
};

function soccerEndpoint(path: string, gameIdsParam: string): BoxScoreEndpoint {
  return {
    path,
    gameIdsParam,
    schema: listSchema(soccerStatRowSchema),
    rowSchema: soccerStatRowSchema,
    columns: SOCCER_COLUMNS,
    ids: (row) => {
      const { player_id: playerId, match_id: gameId } = row as { player_id?: number; match_id?: number };
      return { gameId, playerId, playerName: null };
    },
  };
}
