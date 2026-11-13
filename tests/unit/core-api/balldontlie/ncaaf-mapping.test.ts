import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { ncaafGameListSchema, type NcaafGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaaf-contract';
import {
  CFP_LEAGUE,
  cfpGamesOf,
  cfpGameWindow,
  cfpScopeId,
  parseCfpScope,
  toCfpEvent,
  toCfpFieldParticipants,
  toCfpGameScoreUpdates,
  toNcaafTeamParticipant,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaaf-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const gamesIn = (file: string): NcaafGame[] => ncaafGameListSchema.parse(readBalldontlieFixture('ncaaf', file)).data;
const season2025 = gamesIn('games-2025-season.json');
const season2026 = gamesIn('games-2026-season-partial.json');
const CFP_2025 = { season: 2025 };
const CFP_2026 = { season: 2026 };
const BIG_TEN_TITLE_2025 = 5002;

describe('College Football Playoff scopes', () => {
  it('names a season\'s playoff and reads the name back', () => {
    expect(cfpScopeId(CFP_2025)).toBe('ncaaf-2025-cfp');
    expect(parseCfpScope('ncaaf-2026-cfp')).toEqual(CFP_2026);
  });

  it('reads a golf tournament id, an NFL scope or a malformed id as no College Football Playoff', () => {
    expect(parseCfpScope('41')).toBeNull();
    expect(parseCfpScope('nfl-2025-postseason')).toBeNull();
    expect(parseCfpScope('ncaaf-25-cfp')).toBeNull();
    expect(parseCfpScope('ncaaf-2025-cfp-round-1')).toBeNull();
  });
});

describe('the College Football Playoff\'s date window', () => {
  it.each([
    // [season, first Saturday of December]: a December starting on each kind of day.
    [2018, '2018-12-01'], // December 1 is a Saturday
    [2024, '2024-12-07'], // a Sunday
    [2025, '2025-12-06'], // a Monday
    [2026, '2026-12-05'], // a Tuesday
  ])('opens for the %i season at noon UTC on the day after conference championship Saturday, %s, and closes after January 31', (season, saturday) => {
    const sunday = new Date(`${saturday}T12:00:00.000Z`);
    sunday.setUTCDate(sunday.getUTCDate() + 1);
    expect(cfpGameWindow(season)).toEqual({ from: sunday, to: new Date(`${String(season + 1)}-02-01T12:00:00.000Z`) });
  });

  it('is the rule the league config reads', () => {
    expect(CFP_LEAGUE.window).toBe(cfpGameWindow);
  });

  it('leaves out the 2025 Big Ten title game between two playoff teams, though its Saturday night kickoff falls on the Sunday in UTC', () => {
    const titleGame = season2025.find((game) => game.id === BIG_TEN_TITLE_2025);
    expect(titleGame?.date).toBe('2025-12-07T01:00:00.000Z');

    expect(cfpGamesOf(CFP_2025, season2025).map((game) => game.id)).not.toContain(BIG_TEN_TITLE_2025);
  });

  it('keeps every game from the Army-Navy game through the national championship, and none from the regular season', () => {
    expect(cfpGamesOf(CFP_2025, season2025).map((game) => game.id)).toEqual(
      [5003, 5011, 5012, 5013, 5014, 5021, 5022, 5023, 5024, 5031, 5032, 5041],
    );
  });

  it('keeps no game of another season\'s window', () => {
    expect(cfpGamesOf(CFP_2026, season2025)).toEqual([]);
  });

  it('refuses a game with no date, since it cannot be placed in or out of the window', () => {
    const [undated] = gamesIn('games-2025-season.json');
    delete undated.date;
    expect(() => cfpGamesOf(CFP_2025, [undated])).toThrow(BalldontlieContractError);
  });
});

describe('a College Football Playoff as an event', () => {
  const window2025 = cfpGamesOf(CFP_2025, season2025);
  const window2026 = cfpGamesOf(CFP_2026, season2026);

  it('is complete once its window has closed and every game in it is final, spanning its first game to its last', () => {
    expect(toCfpEvent(CFP_2025, window2025, true, 14)).toEqual({
      externalId: 'ncaaf-2025-cfp',
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      name: 'College Football Playoff',
      startDate: new Date('2025-12-13T20:00:00.000Z'),
      endDate: new Date('2026-01-20T00:30:00.000Z'),
      status: 'COMPLETED',
      participantCount: 14,
      fieldLocked: true,
      metadata: { tour: 'CFP', season: 2025 },
    });
  });

  it('is still under way while its window is open, even with every listed game final: the title game may not be listed yet', () => {
    expect(toCfpEvent(CFP_2025, window2025, false).status).toBe('IN_PROGRESS');
  });

  it('is under way with its field locked once a game is live', () => {
    expect(toCfpEvent(CFP_2026, window2026, false)).toMatchObject({ status: 'IN_PROGRESS', fieldLocked: true });
  });

  it('is scheduled with its field open before any kickoff', () => {
    const notStarted = window2026.filter((game) => game.status_state === CompetitionStatusState.SCHEDULED);
    expect(toCfpEvent(CFP_2026, notStarted, false)).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('names each team playing in the window once, with the league\'s tour so it links only to the site\'s playoff teams', () => {
    const field = toCfpFieldParticipants(window2025);
    expect(field).toHaveLength(14);
    expect(field[0]).toEqual({
      externalId: 'ncaaf-team-93',
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      name: 'Navy Midshipmen',
      active: true,
      metadata: { tour: 'CFP', abbreviation: 'NAVY', conference: 'American' },
    });
  });

  it('refuses a team with no id or no full name', () => {
    expect(() => toNcaafTeamParticipant({ full_name: 'Indiana Hoosiers' }, '/ncaaf/v1/teams')).toThrow('a team has no id');
    expect(() => toNcaafTeamParticipant({ id: 64 }, '/ncaaf/v1/teams')).toThrow('team 64 has no full_name');
  });

  it('carries no abbreviation or conference the vendor leaves out', () => {
    expect(toNcaafTeamParticipant({ id: 64, full_name: 'Indiana Hoosiers' }, '/ncaaf/v1/teams').metadata).toEqual({ tour: 'CFP' });
  });
});

describe('College Football Playoff game scores', () => {
  it('passes on each game\'s prefixed teams, state and score, the national championship among them', () => {
    const updates = toCfpGameScoreUpdates(cfpGamesOf(CFP_2025, season2025));
    expect(updates.at(-1)).toEqual({
      externalGameId: '5041',
      homeTeamExternalId: 'ncaaf-team-64',
      awayTeamExternalId: 'ncaaf-team-76',
      state: ProviderGameState.FINAL,
      homeScore: 27,
      awayScore: 21,
    });
  });

  it('passes on a live score, a scheduled game with no score, and leaves out a game whose state is unknown', () => {
    expect(toCfpGameScoreUpdates(cfpGamesOf(CFP_2026, season2026))).toEqual([
      expect.objectContaining({ externalGameId: '6011', state: ProviderGameState.IN_PROGRESS, homeScore: 14, awayScore: 10 }),
      expect.objectContaining({ externalGameId: '6012', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null }),
    ]);
  });

  it('passes on a final with no score as one, for the writer to skip', () => {
    const [game] = gamesIn('games-2025-season.json');
    delete game.home_score;
    delete game.away_score;
    expect(toCfpGameScoreUpdates([game])).toEqual([expect.objectContaining({ state: ProviderGameState.FINAL, homeScore: null, awayScore: null })]);
  });

  it('refuses a game with no id or a side with no team', () => {
    const [noId, noTeam] = gamesIn('games-2025-season.json');
    delete noId.id;
    delete noTeam.visitor_team;
    expect(() => toCfpGameScoreUpdates([noId])).toThrow('game (no id) has no id');
    expect(() => toCfpGameScoreUpdates([noTeam])).toThrow('has no visitor_team');
  });
});
