import { DEFAULT_DISPLAY_LOCALE, englishLocaleFor } from '@poolmaster/shared/domain';

describe('englishLocaleFor: the locale a member\'s dates are written in', () => {
  it('writes a member\'s dates in English with their region\'s day order and clock, whatever their language', () => {
    expect(englishLocaleFor('de-DE')).toBe('en-DE');
    expect(englishLocaleFor('fr-CA')).toBe('en-CA');
    expect(englishLocaleFor('en-GB')).toBe('en-GB');
  });

  it('writes European English, day before month on a 24-hour clock, for a region with no English locale of its own rather than US order', () => {
    const berlinTime = { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' } as const;
    const instant = new Date('2026-04-09T11:40:00.000Z');

    expect(englishLocaleFor('pt-BR')).toBe('en-150');
    expect(englishLocaleFor('zh-Hant-TW')).toBe('en-150');
    expect(englishLocaleFor('es-419')).toBe('en-150');
    expect(new Intl.DateTimeFormat(englishLocaleFor('pt-BR'), berlinTime).format(instant)).toBe('09/04/2026, 13:40');
  });

  it('writes en-US for a locale with no region, none at all, or one that is not a language tag', () => {
    expect(englishLocaleFor('de')).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor(null)).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor(undefined)).toBe(DEFAULT_DISPLAY_LOCALE);
    expect(englishLocaleFor('not a locale!')).toBe(DEFAULT_DISPLAY_LOCALE);
  });
});
