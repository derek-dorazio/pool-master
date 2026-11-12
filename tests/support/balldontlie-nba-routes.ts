import { z } from 'zod';
import { pagedRoute, type FakeRoute } from './balldontlie-fake-api';
import { readBalldontlieFixture } from './balldontlie-vendor-spec';

/**
 * The fake BALLDONTLIE's NBA replies, served from the fixtures in tests/fixtures/balldontlie/nba
 * and filtered as the vendor filters them: the 2025 Finals (the 2024 season's), the 2025
 * season's first round under way, and a whole made-up 2023 bracket whose Finals (Boston v
 * Dallas) are two games in, the third live, with their stat rows and both teams' active players
 * (#1497). Basketball's lists also read the NCAA tournaments, served empty.
 */

const gameRow = z.looseObject({ id: z.number(), season: z.number(), postseason: z.boolean() });
const gamesIn = (file: string) => z.object({ data: z.array(gameRow) }).parse(readBalldontlieFixture('nba', file)).data;
/** Every fixture game, the 2024 Finals' first. */
export const nbaGames = [...gamesIn('games-2024-finals.json'), ...gamesIn('games-2025-first-round-partial.json'), ...gamesIn('games-2023-playoffs.json')];

const statRow = z.looseObject({ id: z.number(), game: z.looseObject({ id: z.number() }) });
/** The 2023 Finals' first three games' stat rows. */
export const nbaStatRows = z.object({ data: z.array(statRow) }).parse(readBalldontlieFixture('nba', 'stats-2023-finals.json')).data;
const playerRow = z.looseObject({ id: z.number(), team: z.looseObject({ id: z.number() }) });
const activePlayers = z.object({ data: z.array(playerRow) }).parse(readBalldontlieFixture('nba', 'players-active-finals-teams.json')).data;

const emptyBracket: FakeRoute = () => ({ body: { data: [], meta: { per_page: 100 } } });
const emptyTeams: FakeRoute = () => ({ body: { data: [] } });

export const nbaRoutes: Record<string, FakeRoute> = {
  '/nba/v1/games': pagedRoute(nbaGames, (row, query) => {
    const seasons = query.getAll('seasons[]').map(Number);
    return (seasons.length === 0 || seasons.includes(row.season)) && query.get('season_type') === 'playoffs';
  }),
  '/nba/v1/teams': () => ({ body: readBalldontlieFixture('nba', 'teams.json') }),
  '/nba/v1/stats': pagedRoute(nbaStatRows, (row, query) => query.getAll('game_ids[]').map(Number).includes(row.game.id)),
  '/nba/v1/players/active': pagedRoute(activePlayers, (row, query) => query.getAll('team_ids[]').map(Number).includes(row.team.id)),
  '/ncaab/v1/bracket': emptyBracket,
  '/ncaab/v1/teams': emptyTeams,
  '/ncaaw/v1/bracket': emptyBracket,
  '/ncaaw/v1/teams': emptyTeams,
};
