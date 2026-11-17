/**
 * The bracket and series games a best-of-series playoffs gives the provider's slate (#1728):
 * seeding the first round from the standings' ranks, the bracket's links and home sides, and when
 * no bracket is given. Scaffolding builds a two-conference, eight-series first round.
 */

import { MatchSide } from '../../../../packages/shared/domain';
import { CompetitionStatusState } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/competition-status';
import { toNbaSeedRanks, NBA_PLAYOFFS } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nba-mapping';
import {
  firstRoundOrder,
  hasWholeFirstRound,
  toPlayoffsBracket,
  toPlayoffSeriesGames,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoff-bracket';
import type { PlayoffGame, PlayoffsLeague, PlayoffTeam } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/series-playoffs';
import { toWnbaSeedRanks } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/wnba-mapping';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-04-18T17:00:00.000Z');

/** A team id: the conference's hundred plus its seed, West 100s and East 200s. */
const id = (conference: 'West' | 'East', seed: number) => (conference === 'West' ? 100 : 200) + seed;
const teamOf = (conference: 'West' | 'East', seed: number): PlayoffTeam => ({ id: id(conference, seed), name: `${conference} ${String(seed)}`, metadata: { conference } });
const external = (conference: 'West' | 'East', seed: number) => `nba-team-${String(id(conference, seed))}`;

let nextGameId = 1;
function game(home: PlayoffTeam, away: PlayoffTeam, daysIn: number): PlayoffGame {
  nextGameId += 1;
  return { id: nextGameId, season: 2025, postseason: true, start: START + daysIn * DAY, home, away, state: CompetitionStatusState.SCHEDULED, homeScore: null, awayScore: null };
}

/** Each conference's first round, the better seed at home in Game 1; `except` leaves a series out. */
function firstRound(except?: { conference: 'West' | 'East'; topSeed: number }): PlayoffGame[] {
  return (['East', 'West'] as const).flatMap((conference) => [1, 2, 3, 4]
    .filter((seed) => !(except?.conference === conference && except.topSeed === seed))
    .map((seed) => game(teamOf(conference, seed), teamOf(conference, 9 - seed), seed / 10)));
}

/** Standings ranks as the NBA's: the 1 to 6 seeds' ranks are their seeds; the play-in's 7 and 8 ranked the other way round. */
const RANKS = new Map((['West', 'East'] as const).flatMap((conference) => [
  ...[1, 2, 3, 4, 5, 6].map((seed) => [id(conference, seed), seed] as const),
  [id(conference, 7), 8] as const,
  [id(conference, 8), 7] as const,
]));

describe('series playoffs bracket', () => {
  it('orders a group\'s first round top to bottom so each half holds the seeds that meet in it', () => {
    expect(firstRoundOrder(8)).toEqual([1, 4, 3, 2]);
    expect(firstRoundOrder(16)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
    expect(firstRoundOrder(4)).toEqual([1, 2]);
  });

  it('seeds each first-round series by its better team\'s rank, its opponent the matching low seed, whatever the play-in teams\' own ranks', () => {
    const bracket = toPlayoffsBracket(NBA_PLAYOFFS, firstRound(), RANKS);

    expect(bracket?.filter((match) => match.roundNumber === 1).map((match) => [match.matchNumber, match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId])).toEqual([
      [1, 'West', external('West', 1), external('West', 8)],
      [2, 'West', external('West', 4), external('West', 5)],
      [3, 'West', external('West', 3), external('West', 6)],
      [4, 'West', external('West', 2), external('West', 7)],
      [5, 'East', external('East', 1), external('East', 8)],
      [6, 'East', external('East', 4), external('East', 5)],
      [7, 'East', external('East', 3), external('East', 6)],
      [8, 'East', external('East', 2), external('East', 7)],
    ]);
  });

  it('links each two matches into the next, the half with the better seed at home, the West\'s champion home in the Finals', () => {
    const bracket = toPlayoffsBracket(NBA_PLAYOFFS, firstRound(), RANKS) ?? [];

    expect(bracket.map((match) => [match.matchNumber, match.advancesTo])).toEqual([
      [1, { matchNumber: 9, side: MatchSide.HOME }],
      [2, { matchNumber: 9, side: MatchSide.AWAY }],
      [3, { matchNumber: 10, side: MatchSide.AWAY }],
      [4, { matchNumber: 10, side: MatchSide.HOME }],
      [5, { matchNumber: 11, side: MatchSide.HOME }],
      [6, { matchNumber: 11, side: MatchSide.AWAY }],
      [7, { matchNumber: 12, side: MatchSide.AWAY }],
      [8, { matchNumber: 12, side: MatchSide.HOME }],
      [9, { matchNumber: 13, side: MatchSide.HOME }],
      [10, { matchNumber: 13, side: MatchSide.AWAY }],
      [11, { matchNumber: 14, side: MatchSide.HOME }],
      [12, { matchNumber: 14, side: MatchSide.AWAY }],
      [13, { matchNumber: 15, side: MatchSide.HOME }],
      [14, { matchNumber: 15, side: MatchSide.AWAY }],
      [15, null],
    ]);
    expect(bracket.filter((match) => match.roundNumber > 1).every((match) => match.homeTeamExternalId === null && match.awayTeamExternalId === null && match.scheduledAt === null)).toBe(true);
    expect(bracket.find((match) => match.matchNumber === 15)).toMatchObject({ roundNumber: 4, regionLabel: null, isNeutralSite: false });
  });

  it('builds no bracket until the whole first round is out', () => {
    const games = firstRound({ conference: 'West', topSeed: 1 });

    expect(hasWholeFirstRound(NBA_PLAYOFFS, games)).toBe(false);
    expect(toPlayoffsBracket(NBA_PLAYOFFS, games, RANKS)).toBeNull();
  });

  it('builds no bracket when the standings rank neither team of a first-round series', () => {
    const ranks = new Map([...RANKS].filter(([team]) => team !== id('East', 3) && team !== id('East', 6)));

    expect(toPlayoffsBracket(NBA_PLAYOFFS, firstRound(), ranks)).toBeNull();
  });

  it('builds no bracket when two series of a conference come out with the same top seed', () => {
    const ranks = new Map(RANKS).set(id('West', 2), 1);

    expect(toPlayoffsBracket(NBA_PLAYOFFS, firstRound(), ranks)).toBeNull();
  });

  it('builds no bracket when a first-round series is between two conferences', () => {
    const games = [...firstRound({ conference: 'West', topSeed: 4 }), game(teamOf('West', 4), teamOf('East', 5), 0.4)];

    expect(toPlayoffsBracket(NBA_PLAYOFFS, games, RANKS)).toBeNull();
  });

  it('builds no bracket for a league with no bracket shape', () => {
    const league: PlayoffsLeague = { ...NBA_PLAYOFFS, bracket: undefined };

    expect(toPlayoffsBracket(league, firstRound(), RANKS)).toBeNull();
  });

  it('gives each series as one game at its Game 1 tip-off, Game 1\'s home team at home when there is no bracket', () => {
    const west1 = teamOf('West', 1);
    const west8 = teamOf('West', 8);
    const opener = game(west1, west8, 0);
    const second = game(west1, west8, 2);
    const third = game(west8, west1, 4);

    expect(toPlayoffSeriesGames(NBA_PLAYOFFS, [third, second, opener], null)).toEqual([
      { externalGameId: String(opener.id), roundNumber: 1, homeTeamExternalId: external('West', 1), awayTeamExternalId: external('West', 8), scheduledAt: new Date(opener.start), isNeutralSite: false },
    ]);
  });

  it('puts a later series on the sides the bracket gives it, though the team from the away half has home court', () => {
    const opening = firstRound();
    const bracket = toPlayoffsBracket(NBA_PLAYOFFS, opening, RANKS);
    // The West's 1 seed (the home half of match 9) meets the 5 seed (its away half), and the vendor has the 5 seed host Game 1.
    const semifinal = game(teamOf('West', 5), teamOf('West', 1), 14);

    const games = toPlayoffSeriesGames(NBA_PLAYOFFS, [...opening, semifinal], bracket);

    expect(games.find((each) => each.roundNumber === 2)).toMatchObject({ homeTeamExternalId: external('West', 1), awayTeamExternalId: external('West', 5) });
  });

  it('reads the NBA\'s conference ranks and the WNBA\'s playoff seeds by team, leaving out a row without either', () => {
    expect(toNbaSeedRanks([{ team: { id: 2 }, conference_rank: 1 }, { team: { id: 3 } }, { conference_rank: 4 }])).toEqual(new Map([[2, 1]]));
    expect(toWnbaSeedRanks([{ team: { id: 8 }, playoff_seed: 1 }, { team: { id: 3 } }])).toEqual(new Map([[8, 1]]));
  });
});
