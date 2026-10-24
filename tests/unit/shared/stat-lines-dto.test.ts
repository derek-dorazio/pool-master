import { GameStatLineRowSchema } from '@poolmaster/shared/dto';

const participantId = '00000000-0000-4000-8000-000000000001';

describe('a game stat line row', () => {
  it('takes negative yards, as a sack-free run for a loss gives, down to -9999', () => {
    expect(GameStatLineRowSchema.safeParse({ participantId, stats: [{ stat: 'RUSHING_YARDS', value: -3 }, { stat: 'RECEIVING_YARDS', value: -9999 }] }).success).toBe(true);
  });

  it('refuses a negative count of any stat that is not yards', () => {
    const parsed = GameStatLineRowSchema.safeParse({ participantId, stats: [{ stat: 'RUNS', value: -1 }] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual(['RUNS cannot be below 0; only yards go below 0.']);
  });
});
