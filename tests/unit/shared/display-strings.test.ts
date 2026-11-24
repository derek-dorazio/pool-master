import {
  createDisplayStrings,
  displayString,
  displayStringLocaleFor,
  DISPLAY_STRING_MODULES,
  enumLabel,
  enUS,
  flattenDisplayStrings,
  hasDisplayString,
  pluralBaseKey,
  GENERIC_SPORT_WORD_ROLES,
  SOURCE_LOCALE,
  SPORT_WORD_ROLES,
  sportWord,
  type DisplayStringsModule,
} from '@poolmaster/shared/display-strings';
import { ContestStatus, Sport, SUPPORTED_SPORTS } from '@poolmaster/shared/domain';

/** A second language for the lookups to choose between: French words for two entries, and a plural. */
const frFR: DisplayStringsModule = {
  ...enUS,
  enum: {
    ...enUS.enum,
    ContestStatus: { ...enUS.enum.ContestStatus, ACTIVE: 'En direct' },
    Sport: { ...enUS.enum.Sport, AMERICAN_FOOTBALL: 'Football américain' },
  },
  error: { ...enUS.error, CONTEST_FULL: 'Ce concours est complet.' },
  word: { ...enUS.word, roundCount_one: '{{count}} manche', roundCount_other: '{{count}} manches', participant_one: 'concurrent', participant_other: 'concurrents' },
  sport: { ...enUS.sport, GOLF: { ...enUS.sport.GOLF, participant_one: 'golfeur', participant_other: 'golfeurs' } },
};

/** The source language with words the real module does not have yet: a short form, a placeholder and a plural. */
const enWithWords: DisplayStringsModule = {
  ...enUS,
  enum: { ...enUS.enum, Sport: { ...enUS.enum.Sport, AMERICAN_FOOTBALL: { name: 'American football', short: 'Football' } } },
  word: { ...enUS.word, roundCount_one: '{{count}} round', roundCount_other: '{{count}} rounds', championship: { name: 'Championship', short: 'Champ' } },
  sport: { ...enUS.sport, GOLF: { ...enUS.sport.GOLF, eventStart: { name: 'first tee time', short: 'tee time' } } },
};

const strings = createDisplayStrings({ 'en-US': enWithWords, 'fr-FR': frFR });
// The test modules add keys the real module's types do not list yet, so their lookups go through this.
const lookup = strings.displayString as (
  key: string,
  values?: Record<string, string | number>,
  locale?: string | null,
  options?: { form?: 'name' | 'short' },
) => string;

describe('display string lookups', () => {
  it('give an enum value the words the en-US module holds for it', () => {
    expect(enumLabel('ContestStatus', ContestStatus.ACTIVE)).toBe(enUS.enum.ContestStatus.ACTIVE);
    expect(enumLabel('Sport', Sport.GOLF)).toBe(enUS.enum.Sport.GOLF);
  });

  it('give an error code the message the en-US module holds for it', () => {
    expect(displayString('error.CONTEST_FULL')).toBe(enUS.error.CONTEST_FULL);
  });

  it('give a screen\'s own wording of an error code under error.<CODE>.<context>, with its placeholders filled', () => {
    expect(displayString('error.EVENT_YEAR_NOT_EMPTY.leagueYear', { sportLeagueName: 'PGA Tour', events: 'tournaments', year: 2027 }))
      .toBe('PGA Tour already has tournaments in 2027.');
    expect(flattenDisplayStrings(enUS)['error.EVENT_YEAR_NOT_EMPTY.leagueYear']).toBe(enUS.errorContext.EVENT_YEAR_NOT_EMPTY.leagueYear);
  });

  it('say whether a key built at run time has words, so a screen\'s context is tried before the code\'s own message', () => {
    expect(hasDisplayString('error.EVENT_YEAR_NOT_EMPTY.leagueYear')).toBe(true);
    expect(hasDisplayString('error.CONTEST_FULL.leagueYear')).toBe(false);
    expect(hasDisplayString('error.CONTEST_FULL')).toBe(true);
    expect(hasDisplayString('error.CONTEST_FULL', 'fr-CA')).toBe(true);
  });

  it('give the short form when asked, and the name for an entry that has no short form', () => {
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL, { form: 'short' })).toBe('Football');
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL)).toBe('American football');
    expect(strings.enumLabel('Sport', Sport.GOLF, { form: 'short' })).toBe(enUS.enum.Sport.GOLF);
  });

  it('give a French reader the French name, not the English short form, when the French entry has no short form', () => {
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL, { form: 'short', locale: 'fr-FR' })).toBe('Football américain');
    expect(strings.enumLabel('Sport', Sport.AMERICAN_FOOTBALL, { form: 'short', locale: 'en-US' })).toBe('Football');
  });

  it('give any key\'s short form through displayString when asked, and the name otherwise', () => {
    expect(lookup('word.championship', undefined, undefined, { form: 'short' })).toBe('Champ');
    expect(lookup('word.championship')).toBe('Championship');
    expect(displayString('error.CONTEST_FULL', undefined, undefined, { form: 'short' })).toBe(enUS.error.CONTEST_FULL);
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

  it('read sport words by sport code and role, in the plural form the count asks for', () => {
    expect(displayString('sport.GOLF.participant', { count: 1 })).toBe('golfer');
    expect(displayString('sport.GOLF.participant', { count: 3 })).toBe('golfers');
  });

  it('refuse at compile time a key\'s missing or misspelt placeholder values, and values for a key that has none', () => {
    // @ts-expect-error "Week {{n}}" needs its n.
    expect(displayString('word.weekNumber')).toBe('Week {{n}}');
    // @ts-expect-error The placeholder is n, not number.
    expect(displayString('word.weekNumber', { number: 3 })).toBe('Week {{n}}');
    // @ts-expect-error A plural needs its count.
    expect(displayString('word.round', {})).toBe('word.round');
    // @ts-expect-error An error message has no placeholders.
    expect(displayString('error.CONTEST_FULL', { n: 1 })).toBe(enUS.error.CONTEST_FULL);
    expect(displayString('word.weekRange', { first: 1, last: 6 })).toBe('Weeks 1–6');
  });

  it('refuse at compile time a screen\'s error wording without its placeholder values, and fill them when given', () => {
    // @ts-expect-error The league year wording needs its sportLeagueName, events and year.
    expect(displayString('error.EVENT_YEAR_NOT_EMPTY.leagueYear')).toContain('{{sportLeagueName}}');
    // @ts-expect-error The placeholder is year, not season.
    expect(displayString('error.EVENT_YEAR_NOT_EMPTY.leagueYear', { sportLeagueName: 'NFL', events: 'games', season: 2026 }))
      .toContain('{{year}}');
    expect(displayString('error.EVENT_YEAR_NOT_EMPTY.leagueYear', { sportLeagueName: 'NFL', events: 'games', year: 2026 }))
      .toBe('NFL already has games in 2026.');
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
    expect(flat['sport.GOLF.participant_one']).toBe('golfer');
    expect(flat['sport.GOLF.eventStart.short']).toBe('tee time');
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

describe('sport words (#1960)', () => {
  it('give every sport a non-empty word, singular and plural, for every role that has a generic word', () => {
    for (const sport of SUPPORTED_SPORTS) {
      for (const role of GENERIC_SPORT_WORD_ROLES) {
        expect(sportWord(sport, role, { count: 1 }).trim()).not.toBe('');
        expect(sportWord(sport, role, { count: 2 }).trim()).not.toBe('');
      }
    }
  });

  it('read a sport\'s own word in the singular and plural forms', () => {
    expect(sportWord(Sport.GOLF, 'participant')).toBe('golfer');
    expect(sportWord(Sport.GOLF, 'participant', { count: 2 })).toBe('golfers');
    expect(sportWord(Sport.HORSE_RACING, 'sportLeague', { count: 2 })).toBe('circuits');
    expect(sportWord(Sport.AUTO_RACING, 'sportLeague', { count: 1 })).toBe('series');
    expect(sportWord(Sport.SOCCER, 'tie')).toBe('Draw');
    expect(sportWord(Sport.HORSE_RACING, 'withdrawn')).toBe('Scratched');
  });

  it('read the generic word for a role a sport keeps no word of its own for', () => {
    expect(sportWord(Sport.GOLF, 'match', { count: 2 })).toBe('matches');
    expect(sportWord(Sport.HORSE_RACING, 'eliminated')).toBe('Eliminated');
    expect(sportWord(Sport.BASKETBALL, 'scoreUnit')).toBe('points');
    expect(sportWord(Sport.BASKETBALL, 'overtime')).toBe('overtime');
  });

  it('read nothing for an optional role a sport has no word for, and the sport\'s word where it has one', () => {
    expect(sportWord(Sport.GOLF, 'rider')).toBeUndefined();
    expect(sportWord(Sport.HORSE_RACING, 'rider')).toBe('Rider');
    expect(sportWord(Sport.HORSE_RACING, 'topPlaces')).toBe('Win / Place / Show');
    expect(sportWord(Sport.BASKETBALL, 'shootout')).toBeUndefined();
    expect(sportWord(Sport.SOCCER, 'shootout')).toBe('pens');
  });

  it('read only the generic words for no sport', () => {
    expect(sportWord(null, 'participant', { count: 2 })).toBe('participants');
    expect(sportWord(null, 'tie')).toBe('Tie');
    expect(sportWord(null, 'rider')).toBeUndefined();
  });

  it('read the reader\'s language: a French reader\'s golfer is a golfeur, and a sport with no French word of its own reads the French generic word', () => {
    expect(strings.sportWord(Sport.GOLF, 'participant', { count: 2, locale: 'fr-FR' })).toBe('golfeurs');
    expect(strings.sportWord(Sport.GOLF, 'participant', { count: 1, locale: 'fr-FR' })).toBe('golfeur');
    expect(strings.sportWord(null, 'participant', { count: 2, locale: 'fr-FR' })).toBe('concurrents');
  });

  it('give a role\'s short form when asked, and its name where it has none', () => {
    expect(strings.sportWord(Sport.GOLF, 'eventStart', { form: 'short' })).toBe('tee time');
    expect(strings.sportWord(Sport.GOLF, 'eventStart')).toBe('first tee time');
    expect(strings.sportWord(Sport.GOLF, 'withdrawn', { form: 'short' })).toBe('Withdrawn');
  });

  it('refuse at compile time a role that is not a sport word role', () => {
    // @ts-expect-error caddie is not a sport word role.
    expect(sportWord(Sport.GOLF, 'caddie')).toBeUndefined();
  });

  it('list every role a sport entry uses, so no sport keeps a word under a role no lookup reads', () => {
    for (const roles of Object.values(enUS.sport)) {
      for (const key of Object.keys(roles)) {
        expect(SPORT_WORD_ROLES).toContain(key.replace(/_(one|other)$/, ''));
      }
    }
  });
});
