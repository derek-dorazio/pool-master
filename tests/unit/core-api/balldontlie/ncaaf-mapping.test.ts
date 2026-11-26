import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { ncaafGameListSchema, type NcaafGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaaf-contract';
import {
  cfpScopeId,
  parseCfpScope,
  teamsOfGames,
  toCfpEvent,
  toCfpGameScoreUpdates,
  toNcaafTeamParticipant,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/ncaaf-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const gamesIn = (file: string): NcaafGame[] => ncaafGameListSchema.parse(readBalldontlieFixture('ncaaf', file)).data;
const season2025 = gamesIn('games-2025-season.json');
const season2026 = gamesIn('games-2026-season-partial.json');
const CFP_2025 = { season: 2025 };
const CFP_2026 = { season: 2026 };

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

describe('a College Football Playoff as an event', () => {
  it('carries every game of its season as a play with no code and its two teams\' feed ids, for the sync to place by date window, spanning its first game to its last', () => {
    const event = toCfpEvent(CFP_2025, season2025);
    expect(event).toEqual({
      externalId: 'ncaaf-2025-cfp',
      providerId: 'balldontlie',
      sport: Sport.FOOTBALL,
      name: 'College Football Playoff',
      startDate: new Date('2025-11-29T17:00:00.000Z'),
      endDate: new Date('2026-01-20T00:30:00.000Z'),
      status: 'COMPLETED',
      participantCount: undefined,
      fieldLocked: true,
      providerSlots: season2025.map((game) => ({
        code: null, startsAt: new Date(game.date as string), endsAt: new Date(game.date as string), teams: [String(game.home_team?.id), String(game.visitor_team?.id)],
      })),
    });
  });

  it('is under way with its field locked once a game is live', () => {
    expect(toCfpEvent(CFP_2026, season2026)).toMatchObject({ status: 'IN_PROGRESS', fieldLocked: true });
  });

  it('is scheduled with its field open before any kickoff', () => {
    const notStarted = season2026.filter((game) => game.status_state === CompetitionStatusState.SCHEDULED);
    expect(toCfpEvent(CFP_2026, notStarted)).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('refuses a game with no date, since it cannot be placed in any window', () => {
    const [undated] = gamesIn('games-2025-season.json');
    delete undated.date;
    expect(() => toCfpEvent(CFP_2025, [undated])).toThrow(BalldontlieContractError);
  });

  it('names each team its games have once, by the feed\'s raw id', () => {
    const teams = teamsOfGames(season2025);
    expect(new Set(teams.map((team) => team.externalId)).size).toBe(teams.length);
    expect(teams.find((team) => team.externalId === '93')).toEqual({
      externalId: '93',
      providerId: 'balldontlie',
      sport: Sport.FOOTBALL,
      name: 'Navy Midshipmen',
      status: 'ACTIVE',
      metadata: { abbreviation: 'NAVY', conference: 'American' },
    });
  });

  it('refuses a team with no id or no full name', () => {
    expect(() => toNcaafTeamParticipant({ full_name: 'Indiana Hoosiers' }, '/ncaaf/v1/teams')).toThrow('a team has no id');
    expect(() => toNcaafTeamParticipant({ id: 64 }, '/ncaaf/v1/teams')).toThrow('team 64 has no full_name');
  });

  it('carries no abbreviation or conference the vendor leaves out', () => {
    expect(toNcaafTeamParticipant({ id: 64, full_name: 'Indiana Hoosiers' }, '/ncaaf/v1/teams').metadata).toEqual({});
  });
});

describe('College Football Playoff game scores', () => {
  it('passes on each game\'s teams, state and score, the national championship among them', () => {
    const updates = toCfpGameScoreUpdates(season2025);
    expect(updates.at(-1)).toEqual({
      providerGameId: '5041',
      homeTeamExternalId: '64',
      awayTeamExternalId: '76',
      state: ProviderGameState.FINAL,
      homeScore: 27,
      awayScore: 21,
    });
  });

  it('passes on a live score, a scheduled game with no score, and leaves out a game whose state is unknown', () => {
    expect(toCfpGameScoreUpdates(season2026)).toEqual([
      expect.objectContaining({ providerGameId: '6002', state: ProviderGameState.FINAL }),
      expect.objectContaining({ providerGameId: '6011', state: ProviderGameState.IN_PROGRESS, homeScore: 14, awayScore: 10 }),
      expect.objectContaining({ providerGameId: '6012', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null }),
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
