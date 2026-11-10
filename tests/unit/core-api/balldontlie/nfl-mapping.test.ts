import { ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { NflStatusState, nflGameListSchema, type NflGame } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nfl-contract';
import {
  NflScopeKind,
  nflScopeId,
  parseNflScope,
  scopeOfGame,
  seasonTypeOf,
  toGameScoreUpdates,
  toNflFieldParticipants,
  toNflSportEvent,
  toNflSportEvents,
  toNflTeamParticipant,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nfl-mapping';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const gamesIn = (file: string): NflGame[] => nflGameListSchema.parse(readBalldontlieFixture('nfl', file)).data;
const week12 = gamesIn('games-2026-week-12.json');
const [weekFinal, weekLive, weekScheduled, weekUnknown] = week12;
const postseason2025 = gamesIn('games-2025-postseason.json');
const postseason2026 = gamesIn('games-2026-postseason-partial.json');
const WEEK_12 = { kind: NflScopeKind.WEEK, season: 2026, week: 12 } as const;
const POSTSEASON_2025 = { kind: NflScopeKind.POSTSEASON, season: 2025 } as const;

function withState(game: NflGame, status_state: NflStatusState): NflGame {
  return { ...game, status_state };
}

describe('NFL event scopes', () => {
  it('names a week and a postseason by season, and reads each name back', () => {
    expect(nflScopeId(WEEK_12)).toBe('nfl-2026-week-12');
    expect(nflScopeId(POSTSEASON_2025)).toBe('nfl-2025-postseason');
    expect(parseNflScope('nfl-2026-week-12')).toEqual(WEEK_12);
    expect(parseNflScope('nfl-2025-postseason')).toEqual(POSTSEASON_2025);
  });

  it('reads a golf tournament id, a week 0 or a malformed scope as no NFL scope', () => {
    expect(parseNflScope('41')).toBeNull();
    expect(parseNflScope('nfl-2026-week-0')).toBeNull();
    expect(parseNflScope('nfl-2026-week-')).toBeNull();
    expect(parseNflScope('nfl-26-postseason')).toBeNull();
  });

  it('reads a week\'s games as the regular season and the postseason\'s as the postseason', () => {
    expect(seasonTypeOf(WEEK_12)).toBe(2);
    expect(seasonTypeOf(POSTSEASON_2025)).toBe(3);
  });

  it('places a game in its week, or in its season\'s postseason whatever its week', () => {
    expect(scopeOfGame(weekFinal)).toEqual(WEEK_12);
    expect(scopeOfGame(postseason2025[0])).toEqual(POSTSEASON_2025);
  });

  it('refuses to place a game with no season, postseason flag or regular season week', () => {
    expect(() => scopeOfGame({ ...weekFinal, season: undefined })).toThrow('has no season');
    expect(() => scopeOfGame({ ...weekFinal, postseason: undefined })).toThrow('has no postseason');
    expect(() => scopeOfGame({ ...weekFinal, week: undefined })).toThrow(BalldontlieContractError);
    expect(() => scopeOfGame({ ...weekFinal, id: undefined, week: undefined })).toThrow('game (no id) has no week');
  });
});

describe('NFL events', () => {
  it('makes a week one round from its first game to its last, under the NFL league', () => {
    expect(toNflSportEvent(WEEK_12, week12, 8)).toEqual({
      externalId: 'nfl-2026-week-12',
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      name: 'NFL Week 12',
      startDate: new Date('2026-11-26T17:30:00.000Z'),
      endDate: new Date('2026-12-01T01:15:00.000Z'),
      status: 'IN_PROGRESS',
      rounds: 1,
      participantCount: 8,
      fieldLocked: true,
      metadata: { tour: 'NFL', season: 2026, seasonType: 2 },
    });
  });

  it('leaves the playoffs\' rounds to the sport, and completes them only once all 13 games are done', () => {
    expect(toNflSportEvent(POSTSEASON_2025, postseason2025)).toMatchObject({ name: 'NFL Playoffs', status: 'COMPLETED', rounds: undefined });
    expect(toNflSportEvent(POSTSEASON_2025, postseason2025.slice(0, 6))).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('calls a week scheduled until a game starts, and postponed only when every game is', () => {
    expect(toNflSportEvent(WEEK_12, [weekScheduled, weekUnknown])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
    expect(toNflSportEvent(WEEK_12, [withState(weekScheduled, NflStatusState.POSTPONED)])).toMatchObject({ status: 'POSTPONED', fieldLocked: false });
    expect(toNflSportEvent(WEEK_12, [withState(weekScheduled, NflStatusState.POSTPONED), weekScheduled])).toMatchObject({ status: 'SCHEDULED' });
  });

  it('calls a week live while a game is delayed or suspended, or once any game is done', () => {
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, NflStatusState.DELAYED), weekScheduled]).status).toBe('IN_PROGRESS');
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, NflStatusState.SUSPENDED)]).status).toBe('IN_PROGRESS');
    expect(toNflSportEvent(WEEK_12, [weekFinal, weekScheduled]).status).toBe('IN_PROGRESS');
  });

  it('keeps a week scheduled, its field open, when a game is called off before any kicks off', () => {
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, NflStatusState.CANCELED), weekScheduled])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('completes a week whose games are final or called off, and cancels one whose every game was called off', () => {
    expect(toNflSportEvent(WEEK_12, [weekFinal, withState(weekLive, NflStatusState.CANCELED)]).status).toBe('COMPLETED');
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, NflStatusState.CANCELED), withState(weekScheduled, NflStatusState.ABANDONED)]).status).toBe('CANCELLED');
  });

  it('refuses a game with no date', () => {
    expect(() => toNflSportEvent(WEEK_12, [{ ...weekFinal, date: undefined }])).toThrow('has no date');
  });

  it('groups a season\'s games into one event per week and one for the postseason, earliest first', () => {
    const events = toNflSportEvents([...postseason2026, weekLive, weekFinal]);
    expect(events.map((event) => [event.externalId, event.status])).toEqual([
      ['nfl-2026-week-12', 'IN_PROGRESS'],
      ['nfl-2026-postseason', 'IN_PROGRESS'],
    ]);
  });
});

describe('NFL teams', () => {
  it('makes a team a participant with a prefixed id, so it never shares an id with a golfer', () => {
    const [team] = toNflFieldParticipants([weekFinal]);
    expect(team).toEqual({
      externalId: 'nfl-team-25',
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      name: 'Detroit Lions',
      active: true,
      metadata: { abbreviation: 'DET', conference: 'NFC', division: 'NORTH' },
    });
  });

  it('lists each team of a scope\'s games once', () => {
    const teams = toNflFieldParticipants(postseason2025);
    expect(teams).toHaveLength(14);
    expect(new Set(teams.map((team) => team.externalId)).size).toBe(14);
  });

  it('refuses a team with no id or no name, and a game with a side missing', () => {
    expect(() => toNflTeamParticipant({ full_name: 'Detroit Lions' }, '/nfl/v1/teams')).toThrow('a team has no id');
    expect(() => toNflTeamParticipant({ id: 25 }, '/nfl/v1/teams')).toThrow('a team has no full_name');
    expect(() => toNflFieldParticipants([{ ...weekFinal, visitor_team: undefined }])).toThrow('has no visitor_team');
  });
});

describe('NFL game scores', () => {
  it('passes on each game\'s teams, state and score, and leaves out a game whose state the vendor cannot classify', () => {
    expect(toGameScoreUpdates(week12)).toEqual([
      { externalGameId: '401201', homeTeamExternalId: 'nfl-team-25', awayTeamExternalId: 'nfl-team-27', state: ProviderGameState.FINAL, homeScore: 27, awayScore: 24 },
      { externalGameId: '401202', homeTeamExternalId: 'nfl-team-9', awayTeamExternalId: 'nfl-team-4', state: ProviderGameState.IN_PROGRESS, homeScore: 14, awayScore: 10 },
      { externalGameId: '401203', homeTeamExternalId: 'nfl-team-17', awayTeamExternalId: 'nfl-team-3', state: ProviderGameState.SCHEDULED, homeScore: null, awayScore: null },
    ]);
  });

  it.each([
    [NflStatusState.DELAYED, ProviderGameState.IN_PROGRESS],
    [NflStatusState.SUSPENDED, ProviderGameState.IN_PROGRESS],
    [NflStatusState.POSTPONED, ProviderGameState.POSTPONED],
    [NflStatusState.CANCELED, ProviderGameState.CANCELLED],
    [NflStatusState.ABANDONED, ProviderGameState.CANCELLED],
  ])('reads a %s game as %s', (vendorState, state) => {
    expect(toGameScoreUpdates([withState(weekLive, vendorState)])[0].state).toBe(state);
  });

  it('drops a score sent before kickoff, and passes on a final with no score as having none', () => {
    expect(toGameScoreUpdates([withState(weekLive, NflStatusState.POSTPONED)])[0]).toMatchObject({ homeScore: null, awayScore: null });
    expect(toGameScoreUpdates([{ ...weekFinal, home_team_score: undefined, visitor_team_score: undefined }])[0]).toMatchObject({ homeScore: null, awayScore: null });
  });

  it('refuses a game with no id, or a side with no team id', () => {
    expect(() => toGameScoreUpdates([{ ...weekFinal, id: undefined }])).toThrow('has no id');
    expect(() => toGameScoreUpdates([{ ...weekFinal, home_team: { full_name: 'Detroit Lions' } }])).toThrow('has no home_team.id');
    expect(() => toGameScoreUpdates([{ ...weekFinal, visitor_team: undefined }])).toThrow('has no visitor_team');
  });
});
