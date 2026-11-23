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
import type { ApiErrorCode } from '../dto/api-error-codes';
import type {
  DisplayEntry,
  DisplayStringsModule,
  SharedEnumName,
  SharedEnums,
} from './display-strings-module';
import type { enUS } from './en-US';
import { DISPLAY_STRING_MODULES, SOURCE_LOCALE } from './languages';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
type PluralBase<K extends string> = K extends `${infer Base}_${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? Base : K;

type EnumKey = { [E in SharedEnumName]: `enum.${E}.${SharedEnums[E]}` }[SharedEnumName];
type ErrorKey = `error.${ApiErrorCode}`;
type SectionKeys<T, Prefix extends string> = { [K in Extract<keyof T, string>]: `${Prefix}${PluralBase<K>}` }[Extract<keyof T, string>];
type SportWords = typeof enUS.sport;
type SportKey = { [S in Extract<keyof SportWords, string>]: SectionKeys<SportWords[S], `sport.${S}.`> }[Extract<keyof SportWords, string>];

/** Every key a display string can be looked up by, by section; a wrong key fails the type check. */
type KeysBySection = {
  enum: EnumKey;
  error: ErrorKey;
  word: SectionKeys<typeof enUS.word, 'word.'>;
  sport: SportKey;
};
export type DisplayStringKey = KeysBySection[keyof KeysBySection];

/** Values a string's placeholders take: `{ n: 3 }` for "Week {{n}}", `{ count }` for a plural. */
export type DisplayStringValues = Readonly<Record<string, string | number>>;

/** Which form of an entry to show: its name, or its short form, which falls back to the name. */
export type DisplayForm = 'name' | 'short';

export type EnumLabelOptions = { readonly form?: DisplayForm; readonly locale?: string };

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
  for (const [key, entry] of Object.entries(module.word)) add(`word.${key}`, entry);
  for (const [sport, roles] of Object.entries(module.sport)) {
    for (const [role, entry] of Object.entries(roles)) add(`sport.${sport}.${role}`, entry);
  }
  return flat;
}

/** A key with its plural suffix taken off: `word.roundCount_one` is looked up as `word.roundCount`. */
export function pluralBaseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

export type DisplayStrings = {
  /** The locale tag of the module a locale reads: `en-GB` → `en-US`; unknown → `en-US`. */
  readonly moduleLocaleFor: (locale?: string | null) => string;
  readonly displayString: (key: DisplayStringKey, values?: DisplayStringValues, locale?: string | null) => string;
  readonly enumLabel: <E extends SharedEnumName>(enumName: E, code: SharedEnums[E], options?: EnumLabelOptions) => string;
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

  const lookup = (keys: string[], values: DisplayStringValues | undefined, locale: string | null | undefined): string =>
    instance.t(keys, { ...values, lng: moduleLocaleFor(locale) });

  return {
    moduleLocaleFor,
    displayString: (key, values, locale) => lookup([key], values, locale),
    enumLabel: (enumName, code, options) => {
      const key = `enum.${enumName}.${code}`;
      return lookup(options?.form === 'short' ? [`${key}.short`, key] : [key], undefined, options?.locale);
    },
  };
}

const appDisplayStrings = createDisplayStrings(DISPLAY_STRING_MODULES);

/**
 * The words for a key, in the reader's language: `displayString('error.CONTEST_FULL')`,
 * `displayString('word.roundCount', { count: 3 }, user.locale)`.
 */
export function displayString(key: DisplayStringKey, values?: DisplayStringValues, locale?: string | null): string {
  return appDisplayStrings.displayString(key, values, locale);
}

/**
 * The words for one value of a shared enum: `enumLabel('ContestStatus', ContestStatus.LIVE)`.
 * `form: 'short'` gives the entry's short form, or its name when it has none.
 */
export function enumLabel<E extends SharedEnumName>(enumName: E, code: SharedEnums[E], options?: EnumLabelOptions): string {
  return appDisplayStrings.enumLabel(enumName, code, options);
}

/** The locale tag of the module a reader's locale reads. */
export function displayStringLocaleFor(locale?: string | null): string {
  return appDisplayStrings.moduleLocaleFor(locale);
}
