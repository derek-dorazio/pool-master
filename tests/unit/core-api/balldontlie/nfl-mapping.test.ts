import { z } from 'zod';
import { MatchSide, ProviderGameState, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { nflGameListSchema, nflStandingListSchema, type NflGame, type NflStanding } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nfl-contract';
import {
  NflScopeKind,
  nflScopeId,
  parseNflScope,
  scopeOfGame,
  seasonTypeOf,
  toGameScoreUpdates,
  toNflFieldParticipants,
  toNflPlayoffBracket,
  toNflPlayoffField,
  toNflPostseasonGames,
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
const standingRows = z.object({ data: z.array(z.looseObject({ season: z.number() })) }).parse(readBalldontlieFixture('nfl', 'standings.json')).data;
const standings2025: NflStanding[] = nflStandingListSchema.parse({ data: standingRows.filter((row) => row.season === 2025) }).data;
const WEEK_12 = { kind: NflScopeKind.WEEK, season: 2026, week: 12 } as const;
const POSTSEASON_2025 = { kind: NflScopeKind.POSTSEASON, season: 2025 } as const;

function withState(game: NflGame, status_state: CompetitionStatusState): NflGame {
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

  it('gives the playoffs their four rounds, and completes them only once all 13 games are done', () => {
    expect(toNflSportEvent(POSTSEASON_2025, postseason2025)).toMatchObject({ name: 'NFL Playoffs', status: 'COMPLETED', rounds: 4 });
    expect(toNflSportEvent(POSTSEASON_2025, postseason2025.slice(0, 6))).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('calls a week scheduled until a game starts, and postponed only when every game is', () => {
    expect(toNflSportEvent(WEEK_12, [weekScheduled, weekUnknown])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
    expect(toNflSportEvent(WEEK_12, [withState(weekScheduled, CompetitionStatusState.POSTPONED)])).toMatchObject({ status: 'POSTPONED', fieldLocked: false });
    expect(toNflSportEvent(WEEK_12, [withState(weekScheduled, CompetitionStatusState.POSTPONED), weekScheduled])).toMatchObject({ status: 'SCHEDULED' });
  });

  it('calls a week live while a game is delayed or suspended, or once any game is done', () => {
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, CompetitionStatusState.DELAYED), weekScheduled]).status).toBe('IN_PROGRESS');
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, CompetitionStatusState.SUSPENDED)]).status).toBe('IN_PROGRESS');
    expect(toNflSportEvent(WEEK_12, [weekFinal, weekScheduled]).status).toBe('IN_PROGRESS');
  });

  it('keeps a week scheduled, its field open, when a game is called off before any kicks off', () => {
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, CompetitionStatusState.CANCELED), weekScheduled])).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });

  it('completes a week whose games are final or called off, and cancels one whose every game was called off', () => {
    expect(toNflSportEvent(WEEK_12, [weekFinal, withState(weekLive, CompetitionStatusState.CANCELED)]).status).toBe('COMPLETED');
    expect(toNflSportEvent(WEEK_12, [withState(weekLive, CompetitionStatusState.CANCELED), withState(weekScheduled, CompetitionStatusState.ABANDONED)]).status).toBe('CANCELLED');
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
    [CompetitionStatusState.DELAYED, ProviderGameState.IN_PROGRESS],
    [CompetitionStatusState.SUSPENDED, ProviderGameState.IN_PROGRESS],
    [CompetitionStatusState.POSTPONED, ProviderGameState.POSTPONED],
    [CompetitionStatusState.CANCELED, ProviderGameState.CANCELLED],
    [CompetitionStatusState.ABANDONED, ProviderGameState.CANCELLED],
  ])('reads a %s game as %s', (vendorState, state) => {
    expect(toGameScoreUpdates([withState(weekLive, vendorState)])[0].state).toBe(state);
  });

  it('drops a score sent before kickoff, and passes on a final with no score as having none', () => {
    expect(toGameScoreUpdates([withState(weekLive, CompetitionStatusState.POSTPONED)])[0]).toMatchObject({ homeScore: null, awayScore: null });
    expect(toGameScoreUpdates([{ ...weekFinal, home_team_score: undefined, visitor_team_score: undefined }])[0]).toMatchObject({ homeScore: null, awayScore: null });
  });

  it('refuses a game with no id, or a side with no team id', () => {
    expect(() => toGameScoreUpdates([{ ...weekFinal, id: undefined }])).toThrow('has no id');
    expect(() => toGameScoreUpdates([{ ...weekFinal, home_team: { full_name: 'Detroit Lions' } }])).toThrow('has no home_team.id');
    expect(() => toGameScoreUpdates([{ ...weekFinal, visitor_team: undefined }])).toThrow('has no visitor_team');
  });
});

describe('NFL postseason bracket', () => {
  const field = toNflPlayoffField(standings2025);
  const games = toNflPostseasonGames(postseason2025, new Set(field.map((team) => team.externalId)));
  const team = (abbreviation: string) => {
    const found = field.find((participant) => participant.metadata['abbreviation'] === abbreviation);
    if (found === undefined) throw new Error(`no ${abbreviation} in the field`);
    return found.externalId;
  };

  it('seeds each conference\'s top seven from the standings, AFC first and best seed first, and leaves out the eighth', () => {
    expect(field.map((participant) => [participant.metadata['abbreviation'], participant.metadata.seed])).toEqual([
      ['KC', 1], ['BUF', 2], ['BAL', 3], ['HOU', 4], ['LAC', 5], ['PIT', 6], ['DEN', 7],
      ['DET', 1], ['PHI', 2], ['TB', 3], ['LAR', 4], ['MIN', 5], ['WAS', 6], ['GB', 7],
    ]);
  });

  it('puts each postseason game in its round by its week\'s place, the Super Bowl fourth and neutral despite the vendor\'s week 5', () => {
    expect(games.map((game) => game.roundNumber)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 4]);
    expect(games.filter((game) => game.isNeutralSite).map((game) => game.roundNumber)).toEqual([4]);
  });

  it('leaves out a game with a team outside the field, such as an all-star game, and a game whose teams are not decided', () => {
    const allStar: NflGame = { ...postseason2025[0], id: 999, week: 4, home_team: { id: 90, full_name: 'AFC' }, visitor_team: { id: 91, full_name: 'NFC' } };
    const undecided: NflGame = { ...postseason2025[12], id: 998, home_team: undefined };
    const scheduled = toNflPostseasonGames([...postseason2025, allStar, undecided], new Set(field.map((participant) => participant.externalId)));
    expect(scheduled.map((game) => game.externalGameId)).not.toContain('999');
    expect(scheduled.map((game) => game.externalGameId)).not.toContain('998');
    expect(scheduled.at(-1)).toMatchObject({ externalGameId: '402513', roundNumber: 4 });
  });

  it('lays out the whole bracket: the Wild Card by seed, the 1 seeds waiting in the Divisional round, the championships linked to the Super Bowl', () => {
    const bracket = toNflPlayoffBracket(field, games);
    expect(bracket?.map((match) => [match.matchNumber, match.roundNumber, match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId, match.advancesTo, match.isNeutralSite])).toEqual([
      [1, 1, 'AFC', team('BUF'), team('DEN'), null, false],
      [2, 1, 'AFC', team('BAL'), team('PIT'), null, false],
      [3, 1, 'AFC', team('HOU'), team('LAC'), null, false],
      [4, 1, 'NFC', team('PHI'), team('GB'), null, false],
      [5, 1, 'NFC', team('TB'), team('WAS'), null, false],
      [6, 1, 'NFC', team('LAR'), team('MIN'), null, false],
      [7, 2, 'AFC', team('KC'), null, null, false],
      [8, 2, 'AFC', null, null, null, false],
      [9, 2, 'NFC', team('DET'), null, null, false],
      [10, 2, 'NFC', null, null, null, false],
      [11, 3, 'AFC', null, null, { matchNumber: 13, side: MatchSide.HOME }, false],
      [12, 3, 'NFC', null, null, { matchNumber: 13, side: MatchSide.AWAY }, false],
      [13, 4, null, null, null, null, true],
    ]);
  });

  it('gives a Wild Card match its game\'s kickoff once the provider lists it, and none before', () => {
    const listed = toNflPlayoffBracket(field, games);
    expect(listed?.[0]?.scheduledAt).toEqual(new Date('2026-01-11T18:00:00.000Z'));
    expect(listed?.slice(6).every((match) => match.scheduledAt === null)).toBe(true);
    expect(toNflPlayoffBracket(field, [])?.[0]?.scheduledAt).toBeNull();
  });

  it('lays out no bracket until both conferences have their seven seeds', () => {
    expect(toNflPlayoffBracket(field.filter((participant) => participant.metadata.seed !== 7 || participant.metadata['conference'] !== 'NFC'), games)).toBeNull();
    expect(toNflPlayoffBracket([], games)).toBeNull();
  });
});
