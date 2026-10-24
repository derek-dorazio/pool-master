/**
 * The record book (#873): each record ranked from the league's counted contest finishes and its
 * championships of years over, with every holder on a tie and the next best.
 */
import { CupWeight, RecordType, SelectionType, type LeagueYearFinish } from '@poolmaster/shared/domain';
import { rankRecords, type RankedRecord } from '../../../packages/core-api/src/modules/history/records';

let settled = 0;

/** A squad's finish, settled after every finish made before it. */
function finish(squadId: string, place: number, overrides: Partial<LeagueYearFinish> = {}): LeagueYearFinish {
  settled += 1;
  return {
    leagueId: 'league',
    year: 2025,
    squadId,
    contestId: `contest-${String(settled)}`,
    place,
    tiedCount: 1,
    rankedEntryCount: 10,
    eventSeriesId: null,
    selectionType: SelectionType.TIERED,
    weight: CupWeight.NORMAL,
    points: 100,
    settledAt: new Date(Date.UTC(2025, 0, 1) + settled * 60_000),
    ...overrides,
  };
}

function record(records: RankedRecord[], type: RecordType): RankedRecord | undefined {
  return records.find((row) => row.type === type);
}

/** A stand as `[value, [squadId, year, contestId][]]`. */
function stand(row: RankedRecord['best'] | null | undefined) {
  return row ? [row.value, row.holders.map((holder) => [holder.squadId, holder.year, holder.contestId])] : null;
}

describe('rankRecords', () => {
  beforeEach(() => {
    settled = 0;
  });

  it('leaves out every record nobody holds yet', () => {
    expect(rankRecords([finish('eagles', 2), finish('birdies', 3)], [])).toEqual([
      expect.objectContaining({ type: RecordType.LONGEST_PODIUM_RUN }),
    ]);
    expect(rankRecords([], [])).toEqual([]);
  });

  it('counts championships of years over and the longest run of them in consecutive years, two or more, every holder on a tie', () => {
    const records = rankRecords([], [
      { year: 2021, championSquadIds: ['eagles'] },
      { year: 2022, championSquadIds: ['eagles', 'birdies'] },
      { year: 2023, championSquadIds: ['birdies'] },
      { year: 2025, championSquadIds: ['eagles'] },
    ]);

    expect(stand(record(records, RecordType.MOST_CHAMPIONSHIPS)?.best)).toEqual([3, [['eagles', null, null]]]);
    expect(stand(record(records, RecordType.MOST_CHAMPIONSHIPS)?.nextBest)).toEqual([2, [['birdies', null, null]]]);
    // Eagles 2021-22 and Birdies 2022-23 are both two in a row; Eagles' 2025 alone is no run.
    expect(stand(record(records, RecordType.BACK_TO_BACK_CHAMPIONS)?.best)).toEqual([2, [['eagles', 2022, null], ['birdies', 2023, null]]]);
    expect(record(records, RecordType.BACK_TO_BACK_CHAMPIONS)?.nextBest).toBeNull();
  });

  it('counts wins in a year and of all time, a shared 1st counting for each, and leaves out contests not counted', () => {
    const records = rankRecords([
      finish('eagles', 1, { year: 2024 }),
      finish('eagles', 1, { year: 2025 }),
      finish('eagles', 1, { year: 2025, tiedCount: 2 }),
      finish('birdies', 1, { year: 2025, tiedCount: 2, contestId: 'contest-3' }),
      finish('birdies', 1, { year: 2025, weight: CupWeight.NOT_COUNTED }),
      finish('birdies', 1, { year: 2025, weight: CupWeight.NOT_COUNTED }),
    ], []);

    expect(stand(record(records, RecordType.MOST_WINS_IN_A_YEAR)?.best)).toEqual([2, [['eagles', 2025, null]]]);
    expect(stand(record(records, RecordType.MOST_WINS_IN_A_YEAR)?.nextBest)).toEqual([1, [['eagles', 2024, null], ['birdies', 2025, null]]]);
    expect(stand(record(records, RecordType.MOST_WINS_ALL_TIME)?.best)).toEqual([3, [['eagles', null, null]]]);
    expect(stand(record(records, RecordType.MOST_WINS_ALL_TIME)?.nextBest)).toEqual([1, [['birdies', null, null]]]);
  });

  it('finds the longest run of contests on the podium in settlement order, ending in the year it ended, a 4th breaking it', () => {
    const records = rankRecords([
      finish('eagles', 1, { year: 2024 }),
      finish('eagles', 3, { year: 2024 }),
      finish('eagles', 2, { year: 2025 }),
      finish('eagles', 4, { year: 2025 }),
      finish('eagles', 1, { year: 2025 }),
      finish('birdies', 2, { year: 2025 }),
      finish('birdies', 5, { year: 2025 }),
    ], []);

    expect(stand(record(records, RecordType.LONGEST_PODIUM_RUN)?.best)).toEqual([3, [['eagles', 2025, null]]]);
    expect(stand(record(records, RecordType.LONGEST_PODIUM_RUN)?.nextBest)).toEqual([1, [['birdies', 2025, null]]]);
  });

  it('names the win with the most ranked entries and its contest, the next biggest after it', () => {
    const records = rankRecords([
      finish('eagles', 1, { rankedEntryCount: 12, contestId: 'masters' }),
      finish('birdies', 1, { rankedEntryCount: 40, contestId: 'super-bowl' }),
      finish('bogeys', 2, { rankedEntryCount: 60, contestId: 'march-madness' }),
    ], []);

    expect(stand(record(records, RecordType.BIGGEST_FIELD_WON)?.best)).toEqual([40, [['birdies', 2025, 'super-bowl']]]);
    expect(stand(record(records, RecordType.BIGGEST_FIELD_WON)?.nextBest)).toEqual([12, [['eagles', 2025, 'masters']]]);
  });
});
