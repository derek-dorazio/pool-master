import { Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { nhlGameListSchema, nhlTeamListSchema, type NhlGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nhl-contract';
import { isNhlFranchise, NHL_PLAYOFFS, toNhlPlayoffGame, toNhlPlayoffTeam } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nhl-mapping';
import { toPlayoffsEvent } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoffs';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

/** The row at `index`; a fixture without one is a broken fixture. */
function rowAt<Row>(rows: readonly Row[], index: number): Row {
  const row = rows.at(index);
  if (row === undefined) throw new Error(`the fixture has no row ${String(index)}`);
  return row;
}

/** A copy of the game without one field, as a vendor row that leaves it out. */
function without(game: NhlGame, field: keyof NhlGame): NhlGame {
  const copy = { ...game };
  delete copy[field];
  return copy;
}

const gamesIn = (file: string): NhlGame[] => nhlGameListSchema.parse(readBalldontlieFixture('nhl', file)).data;
const postseason2024 = gamesIn('games-2024-postseason.json');
const partial = gamesIn('games-2025-postseason-partial.json');
const partialFinal = rowAt(partial, 0);
const partialScheduled = rowAt(partial, 2);
const florida = rowAt(nhlTeamListSchema.parse(readBalldontlieFixture('nhl', 'teams.json')).data, 6);

describe('NHL playoffs league', () => {
  it('is hockey\'s best-of-seven playoffs, played the year after the season it is numbered by', () => {
    expect(NHL_PLAYOFFS).toMatchObject({ key: 'nhl', tour: 'NHL', sport: Sport.HOCKEY, finalSeriesLength: 7, playoffYearOffset: 1 });
  });
});

describe('toNhlPlayoffTeam', () => {
  it('keeps the team\'s id and full name, with its tricode, conference and division as facts', () => {
    expect(toNhlPlayoffTeam(florida, '/nhl/v1/teams')).toEqual({
      id: 7,
      name: 'Florida Panthers',
      metadata: { abbreviation: 'FLA', conference: 'Eastern', division: 'Atlantic' },
    });
  });

  it('refuses a team with no id or no full name, naming the field and the path', () => {
    expect(() => toNhlPlayoffTeam({ full_name: 'Florida Panthers' }, '/nhl/v1/teams')).toThrow(new BalldontlieContractError('/nhl/v1/teams', ['a team has no id']));
    expect(() => toNhlPlayoffTeam({ id: 7 }, '/nhl/v1/teams')).toThrow(new BalldontlieContractError('/nhl/v1/teams', ['team 7 has no full_name']));
  });
});

describe('isNhlFranchise', () => {
  it('keeps a team in a conference and leaves out one in none, as a folded or moved franchise is', () => {
    expect(isNhlFranchise(florida)).toBe(true);
    expect(isNhlFranchise({ ...florida, conference_name: null })).toBe(false);
    expect(isNhlFranchise({ ...florida, conference_name: '' })).toBe(false);
  });
});

describe('toNhlPlayoffGame', () => {
  it('places a game on its day and reads its season, teams, state and score', () => {
    expect(toNhlPlayoffGame(partialFinal)).toMatchObject({
      id: 2025030111,
      season: 2025,
      start: Date.UTC(2026, 3, 18),
      home: { id: 3, name: 'Carolina Hurricanes' },
      away: { id: 6, name: 'Ottawa Senators' },
      state: 'final',
      homeScore: 3,
      awayScore: 2,
    });
  });

  it('reads a score the vendor sends as null, before the game starts, as no score', () => {
    expect(toNhlPlayoffGame(partialScheduled)).toMatchObject({ state: 'scheduled', homeScore: null, awayScore: null });
    expect(toNhlPlayoffGame(without(without(partialScheduled, 'home_score'), 'away_score'))).toMatchObject({ homeScore: null, awayScore: null });
  });

  it.each(['id', 'season', 'game_date', 'home_team', 'away_team'] as const)('refuses a game with no %s, naming it', (field) => {
    const game = without(partialFinal, field);
    const row = field === 'id' ? 'game (no id)' : 'game 2025030111';
    expect(() => toNhlPlayoffGame(game)).toThrow(new BalldontlieContractError('/nhl/v1/games', [`${row} has no ${field}`]));
  });

  it('refuses a game whose side has no team id, naming the games path', () => {
    expect(() => toNhlPlayoffGame({ ...partialFinal, away_team: { full_name: 'Ottawa Senators' } }))
      .toThrow(new BalldontlieContractError('/nhl/v1/games', ['a team has no id']));
  });

  it('makes a full postseason, sixteen teams to a Stanley Cup Final won four games to two, a completed event of 2025', () => {
    const event = toPlayoffsEvent(NHL_PLAYOFFS, 2024, postseason2024.map(toNhlPlayoffGame));
    expect(event).toMatchObject({
      externalId: 'nhl-2024-postseason',
      name: 'NHL Playoffs',
      sport: Sport.HOCKEY,
      status: 'COMPLETED',
      startDate: new Date('2025-04-19T00:00:00Z'),
      endDate: new Date('2025-06-14T00:00:00Z'),
      metadata: { tour: 'NHL', season: 2024 },
    });
  });
});
