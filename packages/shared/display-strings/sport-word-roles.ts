/**
 * The roles a sport word plays (#1960): what screens call one competitor, one event, one round
 * and so on, by sport. `sport.<SPORT>.<role>` holds a sport's own word; a role with a generic word
 * (`word.<role>`) reads it for a sport that keeps none, so every sport has a word for it. Read
 * them through `sportWord`, never by building a key (`rules/ux-rules.md` §16 *Display Strings*).
 */

/** Roles that name a thing, so they have a singular and a plural (`_one` / `_other`). */
export const SPORT_NOUN_ROLES = ['participant', 'player', 'event', 'sportLeague', 'round', 'match', 'game'] as const;

/** Roles every sport has a word for: its own, or the generic `word.<role>`. */
export const GENERIC_SPORT_WORD_ROLES = [
  ...SPORT_NOUN_ROLES,
  'eliminated',
  'withdrawn',
  'eventStart',
  'overtime',
  'tie',
  'playInPlace',
  'scoreUnit',
] as const;

/**
 * Roles only some sports have a word for, with no generic word: horse racing's Rider column and
 * Win / Place / Show, soccer's shoot-out ("pens"). A screen leaves the thing out where the sport
 * has none.
 */
export const OPTIONAL_SPORT_WORD_ROLES = ['rider', 'topPlaces', 'shootout'] as const;

/** Every role, in one list: what `rules:check:display-strings` holds the sport entries to. */
export const SPORT_WORD_ROLES = [...GENERIC_SPORT_WORD_ROLES, ...OPTIONAL_SPORT_WORD_ROLES] as const;

export type SportNounRole = (typeof SPORT_NOUN_ROLES)[number];
export type GenericSportWordRole = (typeof GENERIC_SPORT_WORD_ROLES)[number];
export type OptionalSportWordRole = (typeof OPTIONAL_SPORT_WORD_ROLES)[number];
export type SportWordRole = GenericSportWordRole | OptionalSportWordRole;

/** The entry keys one role has: a noun's `_one` and `_other`, any other role's own name. */
export type SportWordEntryKey<R extends SportWordRole = SportWordRole> = R extends SportNounRole ? `${R}_one` | `${R}_other` : R;

/** Whether a role names a thing, so a lookup of it takes a count. */
export function isSportNounRole(role: SportWordRole): role is SportNounRole {
  return (SPORT_NOUN_ROLES as readonly string[]).includes(role);
}
