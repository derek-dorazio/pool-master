import { GolfRoundScoreRowSchema, UpdateGolfRoundScoreRequestSchema } from '../../../packages/shared/dto';

// A round's holes are its slot's period count (#2047), so the contract only refuses a negative
// thru; the service refuses one past the round's holes (422 ROUND_THRU_BEYOND_HOLES).
describe('golf score-correction contract — holes', () => {
  const row = { playerName: 'Ana Park', strokes: 70, scoreToPar: -2, status: 'COMPLETED' as const };

  it('accepts an uploaded row with any whole number of holes completed, leaving the round\'s limit to the server', () => {
    expect(GolfRoundScoreRowSchema.safeParse({ ...row, thru: 18 }).success).toBe(true);
    expect(GolfRoundScoreRowSchema.safeParse({ ...row, thru: 19 }).success).toBe(true);
  });

  it('rejects an uploaded row with a negative number of holes completed', () => {
    expect(GolfRoundScoreRowSchema.safeParse({ ...row, thru: -1 }).success).toBe(false);
  });

  it('rejects a single-cell correction with a negative number of holes completed', () => {
    expect(UpdateGolfRoundScoreRequestSchema.safeParse({ thru: -1 }).success).toBe(false);
  });
});
