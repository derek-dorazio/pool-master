import {
  createDisplayStrings,
  displayString,
  displayStringLocaleFor,
  DISPLAY_STRING_MODULES,
  enumLabel,
  enUS,
  flattenDisplayStrings,
  pluralBaseKey,
  SOURCE_LOCALE,
  type DisplayStringsModule,
} from '@poolmaster/shared/display-strings';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';

/** A second language for the lookups to choose between: French words for two entries, and a plural. */
const frFR: DisplayStringsModule = {
  ...enUS,
  enum: { ...enUS.enum, ContestStatus: { ...enUS.enum.ContestStatus, ACTIVE: 'En direct' } },
  error: { ...enUS.error, CONTEST_FULL: 'Ce concours est complet.' },
  word: { roundCount_one: '{{count}} manche', roundCount_other: '{{count}} manches' },
};

/** The source language with words the real module does not have yet: a short form, a placeholder and a plural. */
const enWithWords: DisplayStringsModule = {
  ...enUS,
  enum: { ...enUS.enum, Sport: { ...enUS.enum.Sport, AMERICAN_FOOTBALL: { name: 'American football', short: 'Football' } } },
  word: { weekNumber: 'Week {{n}}', roundCount_one: '{{count}} round', roundCount_other: '{{count}} rounds' },
  sport: { GOLF: { participant: 'Golfer' } },
};

const strings = createDisplayStrings({ 'en-US': enWithWords, 'fr-FR': frFR });
// The test modules add keys the real module's types do not list yet, so their lookups go through this.
const lookup = strings.displayString as (key: string, values?: Record<string, string | number>, locale?: string | null) => string;

describe('display string lookups', () => {
  it('give an enum value the words the en-US module holds for it', () => {
    expect(enumLabel('ContestStatus', ContestStatus.ACTIVE)).toBe(enUS.enum.ContestStatus.ACTIVE);
    expect(enumLabel('Sport', Sport.GOLF)).toBe(enUS.enum.Sport.GOLF);
  });

  it('give an error code the message the en-US module holds for it', () => {
    expect(displayString('error.CONTEST_FULL')).toBe(enUS.error.CONTEST_FULL);
  });

  it('give the short form when asked, and the name for an entry that has no short form', () => {
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL, { form: 'short' })).toBe('Football');
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL)).toBe('American football');
    expect(strings.enumLabel('Sport', Sport.GOLF, { form: 'short' })).toBe(enUS.enum.Sport.GOLF);
  });

  it('pick the module by the language part of the locale, so fr-CA reads fr-FR and en-GB reads en-US', () => {
    expect(strings.moduleLocaleFor('fr-CA')).toBe('fr-FR');
    expect(strings.moduleLocaleFor('FR-fr')).toBe('fr-FR');
    expect(strings.moduleLocaleFor('en-GB')).toBe('en-US');
    expect(strings.enumLabel('ContestStatus', ContestStatus.ACTIVE, { locale: 'fr-CA' })).toBe('En direct');
    expect(lookup('error.CONTEST_FULL', undefined, 'fr')).toBe('Ce concours est complet.');
  });

  it('fall back to en-US for a locale with no module and for a key a module lacks', () => {
    expect(strings.moduleLocaleFor('de-DE')).toBe(SOURCE_LOCALE);
    expect(strings.moduleLocaleFor(undefined)).toBe(SOURCE_LOCALE);
    expect(strings.moduleLocaleFor(null)).toBe(SOURCE_LOCALE);
    expect(strings.enumLabel('ContestStatus', ContestStatus.ACTIVE, { locale: 'de-DE' })).toBe(enUS.enum.ContestStatus.ACTIVE);
    expect(lookup('word.weekNumber', { n: 3 }, 'fr-FR')).toBe('Week 3');
    expect(displayStringLocaleFor('es-MX')).toBe(SOURCE_LOCALE);
  });

  it('fill placeholders and choose plurals by each language\'s rules: French counts 0 as one, English as other', () => {
    expect(lookup('word.weekNumber', { n: 12 })).toBe('Week 12');
    expect(lookup('word.roundCount', { count: 1 })).toBe('1 round');
    expect(lookup('word.roundCount', { count: 0 })).toBe('0 rounds');
    expect(lookup('word.roundCount', { count: 0 }, 'fr-FR')).toBe('0 manche');
    expect(lookup('word.roundCount', { count: 2 }, 'fr-FR')).toBe('2 manches');
  });

  it('read sport words by sport code and role', () => {
    expect(lookup('sport.GOLF.participant')).toBe('Golfer');
  });

  it('refuse at compile time a key the modules do not hold', () => {
    // @ts-expect-error No such error code.
    expect(displayString('error.NOT_A_CODE')).toBe('error.NOT_A_CODE');
    // @ts-expect-error LIVE is not a ContestStatus value.
    expect(enumLabel('ContestStatus', 'LIVE')).toBe('enum.ContestStatus.LIVE');
  });

  it('flatten a module to i18next keys, with a short form under its entry\'s key plus .short', () => {
    const flat = flattenDisplayStrings(enWithWords);

    expect(flat['enum.Sport.AMERICAN_FOOTBALL']).toBe('American football');
    expect(flat['enum.Sport.AMERICAN_FOOTBALL.short']).toBe('Football');
    expect(flat['enum.Sport.GOLF.short']).toBeUndefined();
    expect(flat['word.roundCount_other']).toBe('{{count}} rounds');
    expect(flat['sport.GOLF.participant']).toBe('Golfer');
    expect(flat['error.CONTEST_FULL']).toBe(enUS.error.CONTEST_FULL);
  });

  it('take the plural suffix off a key, and leave a key without one as it is', () => {
    expect(pluralBaseKey('word.roundCount_one')).toBe('word.roundCount');
    expect(pluralBaseKey('word.roundCount_other')).toBe('word.roundCount');
    expect(pluralBaseKey('word.weekNumber')).toBe('word.weekNumber');
  });

  it('ship en-US as the source language', () => {
    expect(Object.keys(DISPLAY_STRING_MODULES)).toContain(SOURCE_LOCALE);
    expect(DISPLAY_STRING_MODULES[SOURCE_LOCALE]).toBe(enUS);
  });
});
