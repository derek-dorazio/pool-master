/**
 * Perpetual trophies (#874): one per contest of one event the league runs again every year, the
 * same series and selection type, with a plate per year's winners.
 */
import type { SeriesContest } from '@poolmaster/shared/db';
import { CupWeight, SelectionType, type LeagueYearFinish } from '@poolmaster/shared/domain';
import { buildPerpetualTrophies, isWeekOfGames } from '../../../packages/core-api/src/modules/history/perpetual-trophies';

function contest(id: string, eventYear: number, overrides: Partial<SeriesContest> = {}): SeriesContest {
  return {
    id,
    selectionType: SelectionType.TIERED,
    cupWeight: CupWeight.NORMAL,
    eventSeriesId: 'masters',
    seriesName: 'Masters Tournament',
    sportLeagueName: 'PGA Tour',
    eventYear,
    completedAt: new Date(`${eventYear}-04-14T00:00:00.000Z`),
    games: { count: 0, roundCount: 0, sendingWinnerOn: 0 },
    ...overrides,
  };
}

function win(contestId: string, squadId: string, place = 1): LeagueYearFinish {
  return {
    leagueId: 'league',
    year: 2025,
    squadId,
    contestId,
    place,
    tiedCount: 1,
    rankedEntryCount: 8,
    weight: CupWeight.NORMAL,
    points: 100,
    settledAt: new Date('2025-04-14T00:00:00.000Z'),
  };
}

/** A trophy as `[seriesName, selectionType, [year, contestId, winners][]]`. */
function shape(trophies: ReturnType<typeof buildPerpetualTrophies>) {
  return trophies.map((trophy) => [trophy.seriesName, trophy.selectionType, trophy.plates.map((plate) => [plate.year, plate.contestId, plate.winnerSquadIds])]);
}

describe('perpetual trophies', () => {
  it('gives a contest run in two years a trophy, newest plate first, with every 1st place squad on a tie', () => {
    const trophies = buildPerpetualTrophies(
      [contest('masters-2024', 2024), contest('masters-2025', 2025)],
      [win('masters-2024', 'eagles'), win('masters-2024', 'birdies'), win('masters-2025', 'bogeys'), win('masters-2025', 'eagles', 2)],
    );

    expect(shape(trophies)).toEqual([
      ['Masters Tournament', SelectionType.TIERED, [[2025, 'masters-2025', ['bogeys']], [2024, 'masters-2024', ['eagles', 'birdies']]]],
    ]);
  });

  it('gives a contest run in only one year no trophy yet, even when run twice that year', () => {
    expect(buildPerpetualTrophies([contest('masters-a', 2025), contest('masters-b', 2025)], [])).toEqual([]);
  });

  it('keeps the same series picked two ways as two trophies, and skips a year the league did not run one', () => {
    const trophies = buildPerpetualTrophies([
      contest('tiered-2022', 2022),
      contest('tiered-2025', 2025),
      contest('budget-2024', 2024, { selectionType: SelectionType.BUDGET_PICK }),
      contest('budget-2025', 2025, { selectionType: SelectionType.BUDGET_PICK }),
    ], []);

    expect(shape(trophies)).toEqual([
      ['Masters Tournament', SelectionType.BUDGET_PICK, [[2025, 'budget-2025', []], [2024, 'budget-2024', []]]],
      ['Masters Tournament', SelectionType.TIERED, [[2025, 'tiered-2025', []], [2022, 'tiered-2022', []]]],
    ]);
  });

  it('shows a plate with no winner for a contest that went final with nobody placed', () => {
    const trophies = buildPerpetualTrophies([contest('masters-2024', 2024), contest('masters-2025', 2025)], [win('masters-2024', 'eagles')]);

    expect(trophies[0]?.plates.map((plate) => plate.winnerSquadIds)).toEqual([[], ['eagles']]);
  });

  it('leaves out contests not counted, so a series run counted only once earns no trophy', () => {
    expect(buildPerpetualTrophies([
      contest('masters-2024', 2024, { cupWeight: CupWeight.NOT_COUNTED }),
      contest('masters-2025', 2025),
    ], [])).toEqual([]);
  });

  it('gives a week of games no trophy, but a single game and a bracket one each', () => {
    const week = { count: 2, roundCount: 1, sendingWinnerOn: 0 };
    const bracket = { count: 3, roundCount: 2, sendingWinnerOn: 2 };
    const bowl = { count: 1, roundCount: 1, sendingWinnerOn: 0 };
    const noGames = { count: 0, roundCount: 0, sendingWinnerOn: 0 };
    const nfl = { sportLeagueName: 'NFL', selectionType: SelectionType.PICK_EM };
    const trophies = buildPerpetualTrophies([
      contest('week-1-2024', 2024, { ...nfl, eventSeriesId: 'week-1', seriesName: 'NFL Week 1', games: week }),
      contest('week-1-2025', 2025, { ...nfl, eventSeriesId: 'week-1', seriesName: 'NFL Week 1', games: week }),
      contest('bowl-2024', 2024, { ...nfl, selectionType: SelectionType.SQUARES, eventSeriesId: 'bowl', seriesName: 'Super Bowl', games: bowl }),
      contest('bowl-2025', 2025, { ...nfl, selectionType: SelectionType.SQUARES, eventSeriesId: 'bowl', seriesName: 'Super Bowl', games: bowl }),
      contest('playoffs-2024', 2024, { ...nfl, selectionType: SelectionType.BRACKET, eventSeriesId: 'playoffs', seriesName: 'NFL Playoffs', games: bracket }),
      contest('playoffs-2025', 2025, { ...nfl, selectionType: SelectionType.BRACKET, eventSeriesId: 'playoffs', seriesName: 'NFL Playoffs', games: bracket }),
    ], []);

    expect(trophies.map((trophy) => trophy.seriesName)).toEqual(['NFL Playoffs', 'Super Bowl']);
    expect(isWeekOfGames(week)).toBe(true);
    expect(isWeekOfGames(noGames)).toBe(false);
    expect(isWeekOfGames(bracket)).toBe(false);
    // Unlinked games over several rounds are a reseeded bracket.
    expect(isWeekOfGames({ count: 4, roundCount: 2, sendingWinnerOn: 0 })).toBe(false);
  });
});
