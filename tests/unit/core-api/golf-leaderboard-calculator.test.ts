import { buildGolfRoundColumns } from '../../../packages/core-api/src/modules/contests/golf-leaderboard-calculator';

describe('golf leaderboard round cells', () => {
  it('renders an in-progress round at level par as "E", the same as the contest entry page and the admin event page', () => {
    const columns = buildGolfRoundColumns([
      { round: 1, strokes: 34, scoreToPar: 0, thru: 9, status: 'IN_PROGRESS' },
    ]);

    expect(columns.r1).toEqual(expect.objectContaining({
      displayType: 'TO_PAR',
      displayValue: 'E',
      thru: 9,
    }));
  });
});
