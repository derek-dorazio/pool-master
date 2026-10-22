import {
  CupPointsScale,
  CupWeight,
  cupFinishPoints,
  cupPlacePoints,
  rankCupTallies,
  squadContestFinishes,
} from '@poolmaster/shared/domain';

const STANDARD = { scale: CupPointsScale.STANDARD, customPoints: [] };
const TOP_TEN = { scale: CupPointsScale.TOP_TEN, customPoints: [] };
const FIELD_BEATEN = { scale: CupPointsScale.FIELD_BEATEN, customPoints: [] };
const CUSTOM = { scale: CupPointsScale.CUSTOM, customPoints: [50, 30, 10] };

describe('cup points for one place (#841)', () => {
  it('pays the STANDARD table 100 to 27 for 1st to 10th, 25 down by 2 to 7 for 11th to 20th, and 5 for every place after', () => {
    const places = Array.from({ length: 22 }, (_, index) => cupPlacePoints(STANDARD, index + 1, 40));
    expect(places).toEqual([100, 80, 65, 55, 48, 42, 37, 33, 30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 5]);
  });

  it('pays the TOP_TEN table 25 to 1 and nothing after 10th', () => {
    const places = Array.from({ length: 11 }, (_, index) => cupPlacePoints(TOP_TEN, index + 1, 40));
    expect(places).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0]);
  });

  it('pays FIELD_BEATEN one point per entry finished behind plus one, so last of eight scores 1', () => {
    expect([1, 2, 8].map((place) => cupPlacePoints(FIELD_BEATEN, place, 8))).toEqual([8, 7, 1]);
  });

  it('pays a CUSTOM table its own list and nothing past its end', () => {
    expect([1, 2, 3, 4].map((place) => cupPlacePoints(CUSTOM, place, 8))).toEqual([50, 30, 10, 0]);
  });
});

describe('cup points for a finish, in tenths (#841)', () => {
  it('pays a lone 1st 100 points as 1000 tenths at x1', () => {
    expect(cupFinishPoints(STANDARD, { place: 1, tiedCount: 1, rankedEntryCount: 10 }, CupWeight.NORMAL)).toBe(1000);
  });

  it('splits 2nd and 3rd between two tied for 2nd: (80 + 65) / 2 = 72.5 each', () => {
    expect(cupFinishPoints(STANDARD, { place: 2, tiedCount: 2, rankedEntryCount: 10 }, CupWeight.NORMAL)).toBe(725);
  });

  it('rounds a three-way split to the tenth: (80 + 65 + 55) / 3 = 66.7', () => {
    expect(cupFinishPoints(STANDARD, { place: 2, tiedCount: 3, rankedEntryCount: 10 }, CupWeight.NORMAL)).toBe(667);
  });

  it('multiplies by the weight: x1.5 for BONUS, x2 for DOUBLE, nothing for NOT_COUNTED', () => {
    const win = { place: 1, tiedCount: 1, rankedEntryCount: 10 };
    expect(cupFinishPoints(STANDARD, win, CupWeight.BONUS)).toBe(1500);
    expect(cupFinishPoints(STANDARD, win, CupWeight.DOUBLE)).toBe(2000);
    expect(cupFinishPoints(STANDARD, win, CupWeight.NOT_COUNTED)).toBe(0);
  });

  it('splits FIELD_BEATEN points the same way: two tied for last of four share 2 and 1, 1.5 each', () => {
    expect(cupFinishPoints(FIELD_BEATEN, { place: 3, tiedCount: 2, rankedEntryCount: 4 }, CupWeight.NORMAL)).toBe(15);
  });
});

describe('a squad\'s finish from its best entry (#841)', () => {
  it('takes each squad\'s best entry, counts the entries sharing that place, and keeps every entry in the field', () => {
    const finishes = squadContestFinishes([
      { squadId: 'eagles', position: 1 },
      { squadId: 'eagles', position: 4 },
      { squadId: 'birdies', position: 2 },
      { squadId: 'bogeys', position: 2 },
    ]);
    expect(finishes).toEqual(expect.arrayContaining([
      { squadId: 'eagles', place: 1, tiedCount: 1, rankedEntryCount: 4 },
      { squadId: 'birdies', place: 2, tiedCount: 2, rankedEntryCount: 4 },
      { squadId: 'bogeys', place: 2, tiedCount: 2, rankedEntryCount: 4 },
    ]));
    expect(finishes).toHaveLength(3);
  });

  it('gives a contest with no ranked entry no finishes', () => {
    expect(squadContestFinishes([])).toEqual([]);
  });
});

describe('ranking cup totals (#841)', () => {
  it('ranks on points, then wins, then podiums, and lets squads equal on all three share the place as T2', () => {
    const ranked = rankCupTallies([
      { squadId: 'c', points: 1000, wins: 0, podiums: 2 },
      { squadId: 'a', points: 1500, wins: 1, podiums: 1 },
      { squadId: 'b', points: 1000, wins: 1, podiums: 1 },
      { squadId: 'd', points: 1000, wins: 0, podiums: 2 },
      { squadId: 'e', points: 0, wins: 0, podiums: 0 },
    ]);
    expect(ranked.map((row) => [row.squadId, row.displayPosition])).toEqual([
      ['a', '1'], ['b', '2'], ['c', 'T3'], ['d', 'T3'], ['e', '5'],
    ]);
  });
});
