import { GolfRoundScoreRowSchema, UpdateGolfRoundScoreRequestSchema } from '../../../packages/shared/dto';

// #375 — a golf round is 18 holes; playoff holes are not part of any round, so an admin
// score can never record a hole past the 18th.
describe('golf score-correction contract — holes', () => {
  const row = { playerName: 'Ana Park', strokes: 70, scoreToPar: -2, status: 'COMPLETED' as const };

  it('accepts an uploaded row through the 18th hole', () => {
    expect(GolfRoundScoreRowSchema.safeParse({ ...row, thru: 18 }).success).toBe(true);
  });

  it('rejects an uploaded row past the 18th hole', () => {
    expect(GolfRoundScoreRowSchema.safeParse({ ...row, thru: 19 }).success).toBe(false);
  });

  it('rejects a single-cell correction past the 18th hole', () => {
    expect(UpdateGolfRoundScoreRequestSchema.safeParse({ thru: 19 }).success).toBe(false);
  });
});
