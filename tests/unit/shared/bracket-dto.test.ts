/**
 * #2184 — a match request names side 1 and side 2 once each: one side, three sides, or the same
 * side twice is refused before it reaches the route.
 */
import { expect } from '@jest/globals';
import { RecordSportEventMatchPeriodScoreRequestSchema } from '@poolmaster/shared/dto';

const sides = (...numbers: number[]) => ({ sides: numbers.map((sideNumber) => ({ sideNumber, score: 3 })) });

describe('a match request\'s sides', () => {
  it('takes side 1 and side 2 once each, in either order', () => {
    expect(RecordSportEventMatchPeriodScoreRequestSchema.safeParse(sides(1, 2)).success).toBe(true);
    expect(RecordSportEventMatchPeriodScoreRequestSchema.safeParse(sides(2, 1)).success).toBe(true);
  });

  it('refuses one side, the same side twice, or three sides', () => {
    expect(RecordSportEventMatchPeriodScoreRequestSchema.safeParse(sides(1)).success).toBe(false);
    expect(RecordSportEventMatchPeriodScoreRequestSchema.safeParse(sides(1, 1)).success).toBe(false);
    expect(RecordSportEventMatchPeriodScoreRequestSchema.safeParse(sides(1, 2, 1)).success).toBe(false);
  });
});
