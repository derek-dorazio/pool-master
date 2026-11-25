/**
 * The one way the app turns a code into words (#1956): `displayString` for any key and
 * `enumLabel` for a shared enum's value, on an i18next instance over the display-string modules.
 * The web app and the email renderer call the same functions, so a word is written once
 * (`rules/ux-rules.md` §16 *Display Strings*).
 *
 * The language part of a locale picks the module (`en-GB` reads `en-US`); a locale with no
 * module, or a key a module lacks, falls back to `en-US`.
 */
import { createInstance, type i18n } from 'i18next';
import type { Sport } from '../domain/enums';
import type { ApiErrorCode } from '../dto/api-error-codes';
import type {
  DisplayEntry,
  DisplayStringsModule,
  SharedEnumName,
  SharedEnums,
} from './display-strings-module';
import type { enUS } from './en-US';
import { DISPLAY_STRING_MODULES, SOURCE_LOCALE } from './languages';
import { isSportNounRole, type OptionalSportWordRole, type SportWordRole } from './sport-word-roles';

type PluralBase<K extends string> = K extends `${infer Base}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? Base : K;

type EnumKey = { [E in SharedEnumName]: `enum.${E}.${SharedEnums[E]}` }[SharedEnumName];
type ErrorKey = `error.${ApiErrorCode}`;
type SectionKeys<T, Prefix extends string> = { [K in Extract<keyof T, string>]: `${Prefix}${PluralBase<K>}` }[Extract<keyof T, string>];
type SportWords = typeof enUS.sport;
type ErrorContexts = typeof enUS.errorContext;
type ErrorContextKey = {
  [C in Extract<keyof ErrorContexts, string>]: `error.${C}.${Extract<keyof ErrorContexts[C], string>}`;
}[Extract<keyof ErrorContexts, string>];
/** A screen's name for its own wording of some error codes: `'pickEm'`, `'bracketAdmin'`. */
export type ErrorContext = {
  [C in keyof ErrorContexts]: Extract<keyof ErrorContexts[C], string>;
}[keyof ErrorContexts];
type SportKey = { [S in Extract<keyof SportWords, string>]: SectionKeys<SportWords[S], `sport.${S}.`> }[Extract<keyof SportWords, string>];

/** Every key a display string can be looked up by, by section; a wrong key fails the type check. */
type KeysBySection = {
  enum: EnumKey;
  error: ErrorKey | ErrorContextKey;
  word: SectionKeys<typeof enUS.word, 'word.'>;
  sport: SportKey;
};
export type DisplayStringKey = KeysBySection[keyof KeysBySection];

/** Values a string's placeholders take: `{ n: 3 }` for "Week {{n}}", `{ count }` for a plural. */
export type DisplayStringValues = Readonly<Record<string, string | number>>;

type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
/** The placeholder names in a string: `'n'` for "Week {{n}}". */
type Placeholders<S> = S extends `${string}{{${infer Name}}}${infer Rest}` ? Name | Placeholders<Rest> : never;
/** The strings an entry can read as: its name and its short form. */
type EntryText<E> = E extends string ? E : E extends { readonly name: infer Name; readonly short: infer Short } ? Name | Short : never;
/** The entries a base key reads in one section: itself, or its plural forms. */
type SectionEntries<Section, Base extends string> = Section[Extract<keyof Section, Base | `${Base}_${PluralSuffix}`>];
/** Whether a base key is a plural, so its lookup takes a `count`. */
type IsPlural<Section, Base extends string> = [Extract<keyof Section, `${Base}_${PluralSuffix}`>] extends [never] ? false : true;
type ValuesIn<Section, Base extends string> = { readonly [P in Placeholders<EntryText<SectionEntries<Section, Base>>>]: string | number }
  & (IsPlural<Section, Base> extends true ? { readonly count: number } : unknown);

/**
 * The values one key's placeholders take, read off the en-US words (#1960): `{ n: number }` for
 * `word.weekNumber` ("Week {{n}}"), `{ count: number }` for a plural, `{ match, … }` for a screen's
 * error wording (`error.<CODE>.<context>`); nothing for a key without placeholders. A missing or misspelt value fails the type check.
 */
export type DisplayStringValuesFor<K extends DisplayStringKey> = K extends `word.${infer Base}`
  ? ValuesIn<typeof enUS.word, Base>
  : K extends `sport.${infer S}.${infer Base}`
    ? S extends keyof SportWords ? ValuesIn<SportWords[S], Base> : never
    : K extends `error.${infer C}.${infer Context}`
      ? C extends keyof ErrorContexts ? ValuesIn<ErrorContexts[C], Context> : never
      : unknown;

/** `displayString`'s arguments after the key: values required exactly when the key has placeholders. */
export type DisplayStringArgs<K extends DisplayStringKey> = keyof DisplayStringValuesFor<K> extends never
  ? [values?: undefined, locale?: string | null, options?: DisplayStringOptions]
  : [values: DisplayStringValuesFor<K>, locale?: string | null, options?: DisplayStringOptions];

/** Which form of an entry to show: its name, or its short form, which falls back to the name. */
export type DisplayForm = 'name' | 'short';

export type DisplayStringOptions = { readonly form?: DisplayForm };

export type EnumLabelOptions = { readonly form?: DisplayForm; readonly locale?: string };

/**
 * Whose words to read: a sport, a sport league definition, or null for the generic words (a
 * contest that names no sport).
 */
export type SportWordSource = Sport | { readonly sport: Sport } | null;

/** A sport word lookup's options: `count` picks a noun's plural form (1 when left out). */
export type SportWordOptions = { readonly count?: number; readonly form?: DisplayForm; readonly locale?: string | null };

/** What a sport word lookup gives: every generic role has a word; an optional role may have none. */
export type SportWordResult<R extends SportWordRole> = R extends OptionalSportWordRole ? string | undefined : string;

/** A sport word lookup, typed by role. */
export type SportWordLookup = <R extends SportWordRole>(source: SportWordSource, role: R, options?: SportWordOptions) => SportWordResult<R>;

/**
 * A module as flat i18next keys: `enum.ContestStatus.LIVE` for an entry's name and
 * `enum.ContestStatus.LIVE.short` for its short form, when it has one.
 */
export function flattenDisplayStrings(module: DisplayStringsModule): Record<string, string> {
  const flat: Record<string, string> = {};
  const add = (key: string, entry: DisplayEntry): void => {
    if (typeof entry === 'string') {
      flat[key] = entry;
      return;
    }
    flat[key] = entry.name;
    flat[`${key}.short`] = entry.short;
  };
  for (const [enumName, values] of Object.entries(module.enum)) {
    for (const [code, entry] of Object.entries(values as Record<string, DisplayEntry>)) add(`enum.${enumName}.${code}`, entry);
  }
  for (const [code, message] of Object.entries(module.error)) add(`error.${code}`, message);
  for (const [code, contexts] of Object.entries(module.errorContext)) {
    for (const [context, message] of Object.entries(contexts)) add(`error.${code}.${context}`, message);
  }
  for (const [key, entry] of Object.entries(module.word)) add(`word.${key}`, entry);
  for (const [sport, roles] of Object.entries(module.sport)) {
    for (const [role, entry] of Object.entries(roles)) add(`sport.${sport}.${role}`, entry);
  }
  return flat;
}

export type DisplayStrings = {
  /** The locale tag of the module a locale reads: `en-GB` → `en-US`; unknown → `en-US`. */
  readonly moduleLocaleFor: (locale?: string | null) => string;
  readonly displayString: <K extends DisplayStringKey>(key: K, ...args: DisplayStringArgs<K>) => string;
  readonly enumLabel: <E extends SharedEnumName>(enumName: E, code: SharedEnums[E], options?: EnumLabelOptions) => string;
  /** Whether a key has words in the reader's language or the source language's. */
  readonly hasDisplayString: (key: string, locale?: string | null) => boolean;
  readonly sportWord: SportWordLookup;
};

/**
 * Lookups over a set of modules, keyed by locale tag. The app's lookups are this over
 * `DISPLAY_STRING_MODULES`; `modules` must hold the source locale.
 */
export function createDisplayStrings(modules: Readonly<Record<string, DisplayStringsModule>>): DisplayStrings {
  const instance: i18n = createInstance();
  void instance.init({
    resources: Object.fromEntries(
      Object.entries(modules).map(([locale, module]) => [locale, { translation: flattenDisplayStrings(module) }]),
    ),
    lng: SOURCE_LOCALE,
    fallbackLng: SOURCE_LOCALE,
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  const locales = Object.keys(modules);

  const moduleLocaleFor = (locale?: string | null): string => {
    if (!locale) return SOURCE_LOCALE;
    const exact = locales.find((candidate) => candidate.toLowerCase() === locale.toLowerCase());
    if (exact) return exact;
    const language = locale.split(/[-_]/)[0]?.toLowerCase();
    if (language === SOURCE_LOCALE.split('-')[0]) return SOURCE_LOCALE;
    return locales.find((candidate) => candidate.split('-')[0]?.toLowerCase() === language) ?? SOURCE_LOCALE;
  };

  /**
   * A short form is read only from the reader's own module: when it has none, the name in that
   * same language wins over another language's short form, and only then does the en-US
   * fallback apply.
   */
  const lookup = (key: string, values: DisplayStringValues | undefined, locale: string | null | undefined, form: DisplayForm | undefined): string => {
    const lng = moduleLocaleFor(locale);
    const shortKey = `${key}.short`;
    const wanted = form === 'short' && instance.getResource(lng, 'translation', shortKey) !== undefined ? shortKey : key;
    return instance.t(wanted, { ...values, lng });
  };

  /** Whether a module holds a key, as itself or in a plural form. */
  const holds = (lng: string, key: string): boolean =>
    instance.getResource(lng, 'translation', key) !== undefined || instance.getResource(lng, 'translation', `${key}_other`) !== undefined;

  /**
   * A sport word (#1960): the sport's own `sport.<SPORT>.<role>`, else the generic `word.<role>`,
   * else none.
   */
  const sportWord = ((source: SportWordSource, role: SportWordRole, options?: SportWordOptions): string | undefined => {
    const sport = typeof source === 'string' || source === null ? source : source.sport;
    const lng = moduleLocaleFor(options?.locale);
    const candidates = sport === null ? [`word.${role}`] : [`sport.${sport}.${role}`, `word.${role}`];
    const key = candidates.find((candidate) => holds(lng, candidate) || holds(SOURCE_LOCALE, candidate));
    if (key === undefined) return undefined;
    const values = isSportNounRole(role) ? { count: options?.count ?? 1 } : undefined;
    return lookup(key, values, options?.locale, options?.form);
  }) as SportWordLookup;

  return {
    moduleLocaleFor,
    displayString: (key, ...[values, locale, options]) => lookup(key, values as DisplayStringValues | undefined, locale, options?.form),
    enumLabel: (enumName, code, options) => lookup(`enum.${enumName}.${code}`, undefined, options?.locale, options?.form),
    hasDisplayString: (key, locale) => instance.exists(key, { lng: moduleLocaleFor(locale) }),
    sportWord,
  };
}

const appDisplayStrings = createDisplayStrings(DISPLAY_STRING_MODULES);

/**
 * The words for a key, in the reader's language: `displayString('error.CONTEST_FULL')`,
 * `displayString('word.weekNumber', { n: 3 }, user.locale)`. `form: 'short'` gives the
 * entry's short form, or its name when it has none.
 */
export function displayString<K extends DisplayStringKey>(key: K, ...args: DisplayStringArgs<K>): string {
  return appDisplayStrings.displayString(key, ...args);
}

/**
 * What a sport's audience calls a role, in the reader's language (#1960):
 * `sportWord(Sport.GOLF, 'participant', { count: 2 })` is "golfers". A sport with no word of its
 * own reads the generic one (`word.participant`); an optional role (`rider`) may have none, and
 * reads undefined.
 */
export const sportWord: SportWordLookup = ((source: SportWordSource, role: SportWordRole, options?: SportWordOptions) =>
  appDisplayStrings.sportWord(source, role, options)) as SportWordLookup;

/**
 * The words for one value of a shared enum: `enumLabel('ContestStatus', ContestStatus.LIVE)`.
 * `form: 'short'` gives the entry's short form, or its name when it has none.
 */
export function enumLabel<E extends SharedEnumName>(enumName: E, code: SharedEnums[E], options?: EnumLabelOptions): string {
  return appDisplayStrings.enumLabel(enumName, code, options);
}

/**
 * Whether a key has words: a key built at run time, such as an error code the API sent with the
 * screen's context (`error.CONTEST_ENTRY_LOCKED.pickEm`), is checked before it is looked up.
 */
export function hasDisplayString(key: string, locale?: string | null): boolean {
  return appDisplayStrings.hasDisplayString(key, locale);
}
