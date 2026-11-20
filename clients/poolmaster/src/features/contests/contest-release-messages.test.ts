import { describe, expect, it } from 'vitest';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';

describe('CONTEST_RELEASE_CODE_MESSAGES', () => {
  it.each(['CONTEST_DRAW_SINGLE_EVENT', 'CONTEST_BRACKET_SINGLE_EVENT', 'CONTEST_SQUARES_SINGLE_EVENT'] as const)(
    'says in its own words why a one-event contest refuses another event (%s), never the server sentence',
    (code) => {
      expect(CONTEST_RELEASE_CODE_MESSAGES[code]).toMatch(/can’t take another event\.$/);
    },
  );
});
