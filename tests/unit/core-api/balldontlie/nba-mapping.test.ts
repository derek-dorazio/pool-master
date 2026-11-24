import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { nbaTeamListSchema } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-contract';
import { toNbaPlayoffGame, toNbaPlayoffTeam, toNbaPlayoffTeams } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-mapping';

/**
 * The NBA normalizers' refusals: the vendor's document leaves every field but the state optional,
 * and a row missing one the playoffs cannot be placed or scored without is a contract error that
 * names the row and the field, not a game quietly dropped. The happy paths run in
 * nba-adapter.test.ts against the fixtures.
 */

const OKC = { id: 21, full_name: 'Oklahoma City Thunder', abbreviation: 'OKC', conference: 'West' as const, division: 'Northwest' as const };
const IND = { id: 12, full_name: 'Indiana Pacers', abbreviation: 'IND', conference: 'East' as const, division: 'Central' as const };
const GAME = {
  id: 18444001,
  date: '2025-06-05',
  datetime: '2025-06-06T00:30:00Z',
  season: 2024,
  postseason: true,
  status_state: CompetitionStatusState.FINAL,
  home_team_score: 110,
  visitor_team_score: 111,
  home_team: OKC,
  visitor_team: IND,
};

describe('NBA playoffs normalizers', () => {
  it('refuses a team with no name, naming the team and the path it came from', () => {
    expect(() => toNbaPlayoffTeam({ id: 21 }, '/nba/v1/teams')).toThrow('team 21 has no full_name');
  });

  it('refuses a game with no id, saying it has none', () => {
    expect(() => toNbaPlayoffGame({ ...GAME, id: undefined })).toThrow('game (no id) has no id');
  });

  it('refuses a game with neither a tip-off nor a day, since it cannot be placed in the playoffs', () => {
    expect(() => toNbaPlayoffGame({ ...GAME, date: undefined, datetime: null })).toThrow('game 18444001 has no date');
  });

  it('refuses a game that does not say whether it is a playoff game, rather than guessing', () => {
    expect(() => toNbaPlayoffGame({ ...GAME, postseason: undefined })).toThrow('game 18444001 has no postseason');
  });

  it('reads a game with no score yet as having none, not 0-0', () => {
    expect(toNbaPlayoffGame({ ...GAME, home_team_score: undefined, visitor_team_score: undefined })).toMatchObject({ homeScore: null, awayScore: null });
  });

  it('reads a teams list holding a defunct franchise with a blank conference and division, keeping only the teams in the East or West', () => {
    // The vendor's document gives both as enums, so this row breaks it and cannot be served by the
    // fake API; the live list is thought to hold such rows (ids above 30) and must not fail on them.
    const page = nbaTeamListSchema.parse({
      data: [
        OKC,
        { id: 37, conference: '', division: '', full_name: 'Chicago Stags', abbreviation: 'CHS' },
        { id: 38, full_name: 'Baltimore Bullets', abbreviation: 'BAL' },
        IND,
      ],
    });

    expect(toNbaPlayoffTeams(page.data).map((team) => team.name)).toEqual(['Oklahoma City Thunder', 'Indiana Pacers']);
  });
});
