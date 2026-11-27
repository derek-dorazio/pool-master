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
import { MLB_POSTSEASON, toMlbSeeds } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/mlb-mapping';
import { NHL_PLAYOFFS, toNhlSeedRanks } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/nhl-mapping';
import { toWnbaSeedRanks } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/wnba-mapping';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-04-18T17:00:00.000Z');

/** A team id: the conference's hundred plus its seed, West 100s and East 200s. */
const id = (conference: 'West' | 'East', seed: number) => (conference === 'West' ? 100 : 200) + seed;
const teamOf = (conference: 'West' | 'East', seed: number): PlayoffTeam => ({ id: id(conference, seed), name: `${conference} ${String(seed)}`, metadata: { conference } });
const external = (conference: 'West' | 'East', seed: number) => String(id(conference, seed));

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

    expect(bracket.map((match) => [match.roundNumber, match.matchNumber, match.advancesTo])).toEqual([
      [1, 1, { roundNumber: 2, matchNumber: 1, side: MatchSide.HOME }],
      [1, 2, { roundNumber: 2, matchNumber: 1, side: MatchSide.AWAY }],
      [1, 3, { roundNumber: 2, matchNumber: 2, side: MatchSide.AWAY }],
      [1, 4, { roundNumber: 2, matchNumber: 2, side: MatchSide.HOME }],
      [1, 5, { roundNumber: 2, matchNumber: 3, side: MatchSide.HOME }],
      [1, 6, { roundNumber: 2, matchNumber: 3, side: MatchSide.AWAY }],
      [1, 7, { roundNumber: 2, matchNumber: 4, side: MatchSide.AWAY }],
      [1, 8, { roundNumber: 2, matchNumber: 4, side: MatchSide.HOME }],
      [2, 1, { roundNumber: 3, matchNumber: 1, side: MatchSide.HOME }],
      [2, 2, { roundNumber: 3, matchNumber: 1, side: MatchSide.AWAY }],
      [2, 3, { roundNumber: 3, matchNumber: 2, side: MatchSide.HOME }],
      [2, 4, { roundNumber: 3, matchNumber: 2, side: MatchSide.AWAY }],
      [3, 1, { roundNumber: 4, matchNumber: 1, side: MatchSide.HOME }],
      [3, 2, { roundNumber: 4, matchNumber: 1, side: MatchSide.AWAY }],
      [4, 1, null],
    ]);
    expect(bracket.filter((match) => match.roundNumber > 1).every((match) => match.homeTeamExternalId === null && match.awayTeamExternalId === null && match.scheduledAt === null)).toBe(true);
    expect(bracket.find((match) => match.roundNumber === 4 && match.matchNumber === 1)).toMatchObject({ regionLabel: null });
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

  it('gives each series as one match at its Game 1 tip-off with each of its games numbered in the order they start, Game 1\'s home team at home when there is no bracket', () => {
    const west1 = teamOf('West', 1);
    const west8 = teamOf('West', 8);
    const opener = game(west1, west8, 0);
    const second = game(west1, west8, 2);
    const third = game(west8, west1, 4);

    expect(toPlayoffSeriesGames([third, second, opener], null)).toEqual([
      { games: [{ providerGameId: String(opener.id), gameNumber: 1 }, { providerGameId: String(second.id), gameNumber: 2 }, { providerGameId: String(third.id), gameNumber: 3 }], roundNumber: 1, homeTeamExternalId: external('West', 1), awayTeamExternalId: external('West', 8), scheduledAt: new Date(opener.start) },
    ]);
  });

  it('puts a later series on the sides the bracket gives it, though the team from the away half has home court', () => {
    const opening = firstRound();
    const bracket = toPlayoffsBracket(NBA_PLAYOFFS, opening, RANKS);
    // The West's 1 seed (the home half of match 9) meets the 5 seed (its away half), and the vendor has the 5 seed host Game 1.
    const semifinal = game(teamOf('West', 5), teamOf('West', 1), 14);

    const games = toPlayoffSeriesGames([...opening, semifinal], bracket);

    expect(games.find((each) => each.roundNumber === 2)).toMatchObject({ homeTeamExternalId: external('West', 1), awayTeamExternalId: external('West', 5) });
  });

  it('reads the NBA\'s conference ranks and the WNBA\'s playoff seeds by team, leaving out a row without either', () => {
    expect(toNbaSeedRanks([{ team: { id: 2 }, conference_rank: 1 }, { team: { id: 3 } }, { conference_rank: 4 }])).toEqual(new Map([[2, 1]]));
    expect(toWnbaSeedRanks([{ team: { id: 8 }, playoff_seed: 1 }, { team: { id: 3 } }])).toEqual(new Map([[8, 1]]));
  });
});

describe('series playoffs bracket by division', () => {
  /** A team of a division, by its rank across the league (1 the best). */
  const hockey = (rank: number, conference: 'Eastern' | 'Western', division: string): PlayoffTeam => ({ id: rank, name: `Team ${String(rank)}`, metadata: { conference, division } });
  const ranks = new Map(Array.from({ length: 16 }, (_, index) => [index + 1, index + 1]));
  // East: Atlantic 1, 4, 5 and Metropolitan 2, 3, 6, wild cards 7 (Atlantic) and 8 (Metropolitan).
  const atl = (rank: number) => hockey(rank, 'Eastern', 'Atlantic');
  const met = (rank: number) => hockey(rank, 'Eastern', 'Metropolitan');
  // West: Central 9, 12, 13 and Pacific 10, 11, 14, wild cards 15 (Central) and 16 (Pacific).
  const cen = (rank: number) => hockey(rank, 'Western', 'Central');
  const pac = (rank: number) => hockey(rank, 'Western', 'Pacific');
  const firstRound = () => [
    game(atl(1), met(8), 0), game(atl(4), atl(5), 0), game(met(2), atl(7), 0), game(met(3), met(6), 0),
    game(cen(9), pac(16), 0), game(cen(12), cen(13), 0), game(pac(10), cen(15), 0), game(pac(11), pac(14), 0),
  ];
  const sides = (games: PlayoffGame[]) => toPlayoffsBracket(NHL_PLAYOFFS, games, ranks)
    ?.filter((match) => match.roundNumber === 1)
    .map((match) => [match.regionLabel, match.homeTeamExternalId, match.awayTeamExternalId]);

  it('lists each division\'s winner against its wild card, then its second against its third, divisions and conferences in the league\'s order', () => {
    const team = (rank: number) => String(rank);

    expect(sides(firstRound())).toEqual([
      ['East', team(1), team(8)], ['East', team(4), team(5)], ['East', team(2), team(7)], ['East', team(3), team(6)],
      ['West', team(9), team(16)], ['West', team(12), team(13)], ['West', team(10), team(15)], ['West', team(11), team(14)],
    ]);
  });

  it('takes a division\'s winner as the better-ranked of the two teams heading its series, though a wild card from its own division meets it', () => {
    // The Atlantic's own wild card (7) meets its winner (1): both of its series are within the division.
    const games = [game(atl(1), atl(7), 0), game(atl(4), atl(5), 0), game(met(2), met(8), 0), game(met(3), met(6), 0), ...firstRound().slice(4)];

    expect(sides(games)?.slice(0, 2)).toEqual([['East', '1', '7'], ['East', '4', '5']]);
  });

  it('places a division\'s winner by its division even when the wild card it meets has more points, with the wild card at home', () => {
    // Metropolitan 1, 2, 3 and its 4th (4) take a wild card; the Atlantic's winner is only 5th,
    // with 6 and 7, and the Atlantic's 8 takes the other wild card. The better wild card (4)
    // meets the lesser winner (5) and out-ranks it.
    const games = [game(met(1), atl(8), 0), game(met(2), met(3), 0), game(atl(5), met(4), 0), game(atl(6), atl(7), 0), ...firstRound().slice(4)];
    const team = (rank: number) => String(rank);

    expect(sides(games)?.slice(0, 4)).toEqual([['East', team(4), team(5)], ['East', team(6), team(7)], ['East', team(1), team(8)], ['East', team(2), team(3)]]);
  });

  it('builds no bracket when a division\'s second meets a team from another division', () => {
    const games = [game(atl(1), met(8), 0), game(atl(4), met(6), 0), game(met(2), atl(7), 0), game(met(3), atl(5), 0), ...firstRound().slice(4)];

    expect(toPlayoffsBracket(NHL_PLAYOFFS, games, ranks)).toBeNull();
  });

  it('builds no bracket when a division heads other than two series', () => {
    const games = [game(atl(1), met(8), 0), game(atl(4), met(6), 0), game(atl(5), atl(7), 0), game(met(2), met(3), 0), ...firstRound().slice(4)];

    expect(toPlayoffsBracket(NHL_PLAYOFFS, games, ranks)).toBeNull();
  });

  it('builds no bracket while the standings leave a first-round team unranked, since its division\'s winner cannot be told', () => {
    expect(toPlayoffsBracket(NHL_PLAYOFFS, firstRound(), new Map([...ranks].filter(([team]) => team !== 6)))).toBeNull();
  });

  it('ranks NHL teams by points, then regulation wins, regulation and overtime wins and wins, leaving out a row without points', () => {
    const row = (id: number, points: number | undefined, regulationWins = 30, regulationPlusOtWins = 35, wins = 40) => ({ team: { id }, points, regulation_wins: regulationWins, regulation_plus_ot_wins: regulationPlusOtWins, wins });

    expect([...toNhlSeedRanks([row(1, 100), row(2, 104), row(3, 100, 32), row(4, 100, 32, 36), row(5, undefined), row(6, 100, 30, 35, 40)])]).toEqual([
      [2, 1], [4, 2], [3, 3], [1, 4], [6, 5],
    ]);
  });
});

describe('series playoffs bracket with byes', () => {
  /** A club by its seed in its league: American 1xx, National 2xx. */
  const club = (league: 'American' | 'National', seed: number): PlayoffTeam => ({ id: (league === 'American' ? 100 : 200) + seed, name: `${league} ${String(seed)}`, metadata: { league } });
  const seeds = new Map((['American', 'National'] as const).flatMap((league) => [1, 2, 3, 4, 5, 6].map((seed) => [club(league, seed).id, seed] as const)));
  const teams = (['American', 'National'] as const).flatMap((league) => [1, 2, 3, 4, 5, 6].map((seed) => club(league, seed)));
  const wildCard = (pairs: Array<[number, number]> = [[4, 5], [3, 6]]) => (['American', 'National'] as const)
    .flatMap((league) => pairs.map(([home, away]) => game(club(league, home), club(league, away), 0)));

  it('builds no bracket when a league\'s first round is not its 4 v 5 and 3 v 6', () => {
    expect(toPlayoffsBracket(MLB_POSTSEASON, wildCard([[3, 5], [4, 6]]), seeds, teams)).toBeNull();
  });

  it('builds no bracket while a top seed is missing from the league\'s teams', () => {
    expect(toPlayoffsBracket(MLB_POSTSEASON, wildCard(), seeds, teams.filter((team) => team.id !== club('National', 2).id))).toBeNull();
  });

  it('puts each league\'s 1 seed home against the 4/5 winner and its 2 seed against the 3/6 winner', () => {
    const bracket = toPlayoffsBracket(MLB_POSTSEASON, wildCard(), seeds, teams);

    expect(bracket?.filter((match) => match.roundNumber === 2).map((match) => [match.regionLabel, match.homeTeamExternalId])).toEqual([
      ['AL', '101'], ['AL', '102'], ['NL', '201'], ['NL', '202'],
    ]);
  });

  it('seeds each league\'s division winners 1 to 3 by league place, then its next three clubs 4 to 6, and seeds no league whose places are missing', () => {
    const row = (id: number, league: string, divisionRank: number | undefined, leagueRank: number) => ({ team: { id, league }, division_rank: divisionRank, league_rank: leagueRank });
    const american = [row(1, 'American', 2, 1), row(2, 'American', 1, 2), row(3, 'American', 1, 3), row(4, 'American', 2, 4), row(5, 'American', 1, 5), row(6, 'American', 3, 6), row(7, 'American', 2, 7), row(8, 'American', 4, 8)];
    const national = [row(11, 'National', 1, 1), row(12, 'National', undefined, 2)];

    expect([...toMlbSeeds([...american, ...national])]).toEqual([[2, 1], [3, 2], [5, 3], [1, 4], [4, 5], [6, 6]]);
  });
});
