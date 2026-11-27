import { describe, expect, it } from 'vitest';
import { errorCodeMessage } from '@/lib/errors';

describe('contest setup error wording', () => {
  it.each(['CONTEST_DRAW_SINGLE_EVENT', 'CONTEST_BRACKET_SINGLE_EVENT', 'CONTEST_SQUARES_SINGLE_EVENT'] as const)(
    'says in the setup screens\' own words why a one-event contest refuses another event (%s)',
    (code) => {
      expect(errorCodeMessage(code, { context: 'contestSetup' })).toMatch(/can’t take another event\.$/);
    },
  );
});
