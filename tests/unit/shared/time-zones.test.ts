import { DEFAULT_DISPLAY_LOCALE, englishLocaleFor } from '@poolmaster/shared/domain';

describe('englishLocaleFor: the locale a member\'s dates are written in', () => {
  it('writes a member\'s dates in English with their region\'s day order and clock, whatever their language', () => {
    expect(englishLocaleFor('de-DE')).toBe('en-DE');
    expect(englishLocaleFor('fr-CA')).toBe('en-CA');
    expect(englishLocaleFor('zh-Hant-TW')).toBe('en-TW');
    expect(englishLocaleFor('es-419')).toBe('en-419');
    expect(englishLocaleFor('en-GB')).toBe('en-GB');
  });

  it('writes en-US for a locale with no region, none at all, or one that is not a language tag', () => {
    expect(englishLocaleFor('de')).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor(null)).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor(undefined)).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor('not a locale!')).toBe(DEFAULT_DISPLAY_LOCALE);
  });
});
