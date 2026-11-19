import { isPlatformSearchTerm } from '@poolmaster/shared/domain';

describe('platform-wide list search terms (#1180, #1313)', () => {
  it('accepts a term of 3 or more characters once trimmed, and refuses a missing, blank or shorter one', () => {
    expect(isPlatformSearchTerm('der')).toBe(true);
    expect(isPlatformSearchTerm('  de  ')).toBe(false);
    expect(isPlatformSearchTerm('   ')).toBe(false);
    expect(isPlatformSearchTerm(undefined)).toBe(false);
  });
});
