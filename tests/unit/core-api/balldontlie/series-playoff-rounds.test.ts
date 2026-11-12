import { describe, expect, it } from '@jest/globals';
import { ProviderGameState, Sport, SportStat } from '@poolmaster/shared/domain';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import {
  parsePlayoffRoundScope,
  playoffRoundScopeId,
  playoffSeries,
  toPlayoffPlayerParticipant,
  toPlayoffRoundBoxScores,
  toPlayoffRoundEvent,
  toPlayoffRoundEvents,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoff-rounds';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoffs';

// A playoff round as a Clutch Card's event (#1497), on made-up leagues: a four-team one whose
// rounds are best of three, and a six-team one whose top two seeds sit out the first round.
const LEAGUE: PlayoffsLeague = {
  key: 'tst',
  tour: 'TST',
  sport: Sport.BASKETBALL,
  eventName: 'Test Playoffs',
  rounds: [
    { name: 'Test Semifinals', seriesLength: 3, seriesCount: 2 },
    { name: 'Test Final', seriesLength: 3, seriesCount: 1 },
  ],
  playoffYearOffset: 1,
  seasonRolloverMonth: 8,
};

const BYE_LEAGUE: PlayoffsLeague = {
  ...LEAGUE,
  key: 'bye',
  rounds: [
    { name: 'Wild Card', seriesLength: 3, seriesCount: 2 },
    { name: 'Division Series', seriesLength: 3, seriesCount: 2 },
    { name: 'Championship', seriesLength: 3, seriesCount: 1 },
  ],
};

const team = (id: number): PlayoffTeam => ({ id, name: `Team ${String(id)}`, metadata: {} });

let nextId = 1;
function game(day: number, home: number, away: number, homeScore: number | null, awayScore: number | null, state: CompetitionStatusState = CompetitionStatusState.FINAL): PlayoffGame {
  return { id: nextId++, season: 2025, postseason: true, start: Date.UTC(2026, 3, day), home: team(home), away: team(away), state, homeScore, awayScore };
}

/** Semifinals 1 v 4 and 2 v 3, each won 2-0 by the home side. */
function semifinals(): PlayoffGame[] {
  return [game(1, 1, 4, 100, 90), game(2, 2, 3, 99, 98), game(3, 4, 1, 80, 95), game(4, 3, 2, 70, 71)];
}

const pairs = (games: readonly PlayoffGame[]) => playoffSeries(games).map((series) => [series.round, `${String(series.games[0].home.id)}v${String(series.games[0].away.id)}`, series.games.length]);

describe('playoff round scopes', () => {
  it('names a round by the league\'s key, season and round, and reads them back', () => {
    expect(playoffRoundScopeId(LEAGUE, 2025, 2)).toBe('tst-2025-postseason-round-2');
    expect(parsePlayoffRoundScope(LEAGUE, 'tst-2025-postseason-round-2')).toEqual({ season: 2025, round: 2 });
  });

  it('refuses a round the league does not play, another league\'s round and a whole playoffs\' id', () => {
    expect(parsePlayoffRoundScope(LEAGUE, 'tst-2025-postseason-round-0')).toBeNull();
    expect(parsePlayoffRoundScope(LEAGUE, 'tst-2025-postseason-round-3')).toBeNull();
    expect(parsePlayoffRoundScope(LEAGUE, 'nba-2025-postseason-round-1')).toBeNull();
    expect(parsePlayoffRoundScope(LEAGUE, 'tst-2025-postseason')).toBeNull();
  });
});

describe('playoffSeries', () => {
  it('groups the games by their two teams, whichever is at home, each series\' games in the order they start', () => {
    const games = [...semifinals(), game(6, 2, 1, 90, 80), game(5, 1, 2, 88, 70)];

    const series = playoffSeries(games);

    expect(pairs(games)).toEqual([[1, '1v4', 2], [1, '2v3', 2], [2, '1v2', 2]]);
    expect(series[2].games.map((each) => each.start)).toEqual([Date.UTC(2026, 3, 5), Date.UTC(2026, 3, 6)]);
  });

  it('puts a series that sits out round 1 for its seeded team in round 2, one past its opponent\'s first series', () => {
    // 3 v 6 and 4 v 5 play the wild card; 1 and 2 meet their winners, then each other.
    const games = [
      game(1, 3, 6, 5, 2), game(1, 4, 5, 3, 1),
      game(4, 1, 4, 6, 0), game(4, 2, 3, 4, 2),
      game(9, 1, 2, 2, 1),
    ];

    expect(pairs(games)).toEqual([[1, '3v6', 1], [1, '4v5', 1], [2, '1v4', 1], [2, '2v3', 1], [3, '1v2', 1]]);
  });

  it('orders two series that start the same moment by their teams, so a round reads the same every sync', () => {
    const games = [game(1, 2, 3, 1, 0), game(1, 1, 4, 1, 0)];

    expect(pairs(games)).toEqual([[1, '1v4', 1], [1, '2v3', 1]]);
  });
});

describe('playoffSeries game order', () => {
  it('orders a series\' two games listed for the same moment by their ids, so their numbers hold every sync', () => {
    const later = game(1, 1, 2, null, null, CompetitionStatusState.SCHEDULED);
    const earlier = { ...game(1, 2, 1, null, null, CompetitionStatusState.SCHEDULED), id: later.id - 100 };

    expect(playoffSeries([later, earlier])[0].games.map((each) => each.id)).toEqual([earlier.id, later.id]);
  });
});

describe('toPlayoffRoundEvent', () => {
  it('spans the round\'s games and carries its name, as its tour too, its season and round, in progress while it is short of series', () => {
    const semis = playoffSeries(semifinals()).filter((each) => each.round === 1);

    const event = toPlayoffRoundEvent(LEAGUE, 2025, 1, semis.slice(0, 1), 10);

    expect(event).toMatchObject({
      externalId: 'tst-2025-postseason-round-1',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'Test Semifinals',
      startDate: new Date(Date.UTC(2026, 3, 1)),
      endDate: new Date(Date.UTC(2026, 3, 3)),
      status: 'IN_PROGRESS',
      participantCount: 10,
      fieldLocked: true,
      metadata: { tour: 'Test Semifinals', season: 2025, round: 1 },
    });
  });

  it('completes once its every series is listed and decided', () => {
    const semis = playoffSeries(semifinals());

    expect(toPlayoffRoundEvent(LEAGUE, 2025, 1, semis).status).toBe('COMPLETED');
  });

  it('stays in progress while a series is level, every game of it final so far', () => {
    const series = playoffSeries([game(1, 1, 2, 90, 80), game(2, 2, 1, 90, 80)]);

    expect(toPlayoffRoundEvent(LEAGUE, 2025, 2, series).status).toBe('IN_PROGRESS');
  });

  it('is scheduled, its field open for picks, while none of its games has started', () => {
    const series = playoffSeries([game(5, 1, 2, null, null, CompetitionStatusState.SCHEDULED)]);

    expect(toPlayoffRoundEvent(LEAGUE, 2025, 2, series)).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
  });
});

describe('toPlayoffRoundEvents', () => {
  it('makes one event per round the games have reached, in round order, leaving out a round past the league\'s last', () => {
    // A third meeting chain the league has no round for: 1 v 3 after 1 v 2.
    const games = [...semifinals(), game(5, 1, 2, 90, 80), game(8, 1, 3, 90, 80)];

    expect(toPlayoffRoundEvents(LEAGUE, 2025, games).map((event) => [event.externalId, event.name])).toEqual([
      ['tst-2025-postseason-round-1', 'Test Semifinals'],
      ['tst-2025-postseason-round-2', 'Test Final'],
    ]);
  });

  it('names a bye league\'s rounds by its own round list', () => {
    const games = [game(1, 3, 6, 5, 2), game(4, 1, 3, 6, 0)];

    expect(toPlayoffRoundEvents(BYE_LEAGUE, 2025, games).map((event) => event.name)).toEqual(['Wild Card', 'Division Series']);
  });
});

describe('toPlayoffRoundBoxScores', () => {
  it('numbers each series\' games from 1, so two series\' Game 2 both land on game 2, with each player\'s line under the league\'s player id', () => {
    const series = playoffSeries(semifinals());
    const gameIds = series.flatMap((each) => each.games.map((one) => one.id));
    const line = { gameId: gameIds[1], playerId: 7, stats: [{ stat: SportStat.POINTS, value: 30 }] };

    const scores = toPlayoffRoundBoxScores(LEAGUE, series, [line]);

    expect(scores.map((each) => [each.externalGameId, each.gameNumber, each.state, each.lines])).toEqual([
      [String(gameIds[0]), 1, ProviderGameState.FINAL, []],
      [String(gameIds[1]), 2, ProviderGameState.FINAL, [{ participantExternalId: 'tst-player-7', stats: [{ stat: SportStat.POINTS, value: 30 }] }]],
      [String(gameIds[2]), 1, ProviderGameState.FINAL, []],
      [String(gameIds[3]), 2, ProviderGameState.FINAL, []],
    ]);
  });

  it('leaves out a game the vendor cannot classify, keeping the numbers of the games around it', () => {
    const series = playoffSeries([game(1, 1, 2, 90, 80), game(2, 2, 1, null, null, CompetitionStatusState.UNKNOWN), game(3, 1, 2, null, null, CompetitionStatusState.IN_PROGRESS)]);

    expect(toPlayoffRoundBoxScores(LEAGUE, series, []).map((each) => [each.gameNumber, each.state])).toEqual([
      [1, ProviderGameState.FINAL],
      [3, ProviderGameState.IN_PROGRESS],
    ]);
  });
});

describe('toPlayoffPlayerParticipant', () => {
  it('names a player by the league\'s prefixed id, keeping the league\'s facts about him, under the round\'s name as tour', () => {
    expect(toPlayoffPlayerParticipant(LEAGUE, 2, { id: 42, name: 'Sam Shooter', metadata: { position: 'G' } })).toEqual({
      externalId: 'tst-player-42',
      providerId: 'balldontlie',
      sport: Sport.BASKETBALL,
      name: 'Sam Shooter',
      active: true,
      metadata: { position: 'G', tour: 'Test Final' },
    });
  });
});
