import { describe, expect, it } from 'vitest';
import { errorCodeMessage } from '@/lib/errors';

describe('contest setup error wording', () => {
  it.each(['CONTEST_DRAW_SINGLE_EVENT', 'CONTEST_BRACKET_SINGLE_EVENT', 'CONTEST_SQUARES_SINGLE_EVENT'] as const)(
    'says in the setup screens\' own words why a one-event contest refuses another event (%s)',
    (code) => {
      expect(errorCodeMessage(code, { context: 'contestSetup' })).toMatch(/can’t take another event\.$/);
    },
  );

  it('words the events page\'s own refusals first and falls back to the setup screens\' wording', () => {
    const context = ['contestEvents', 'contestSetup'] as const;
    expect(errorCodeMessage('CONTEST_EVENTS_LEAGUE_MISMATCH', { context })).toBe('Every event in a contest comes from the same league.');
    expect(errorCodeMessage('CONTEST_SQUARES_SINGLE_EVENT', { context })).toBe('A squares contest is played on one game, so it can’t take another event.');
  });
});
