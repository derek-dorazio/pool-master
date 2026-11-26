import { sportWord, type SportWordSource } from '../../display-strings/display-strings';
import type { SportNounRole } from '../../display-strings/sport-word-roles';
import type { SportNoun } from './sport-definition';

/**
 * What a sport's audience calls things (#1960), read from the display strings in the reader's
 * language: `sport.<SPORT>.<role>`, else the generic `word.<role>`. Shared screens read these
 * instead of saying "golfer". The registry keeps no words.
 */
export interface SportVocabulary {
  /** One competitor: "golfer" / "golfers". */
  participant: SportNoun;
  /** One event a contest runs on: "tournament" for golf, "race" for horse racing. */
  event: SportNoun;
  /** One sport league, the organiser whose events recur each year: "tour" for golf (the PGA Tour). */
  sportLeague: SportNoun;
  /** One scheduled stage of an event: "round", "race" for racing. */
  round: SportNoun;
  /** One head-to-head match of a bracket: "game" for basketball, "series" for baseball, else "match". */
  match: SportNoun;
  /** One game played: "match" for soccer, else "game". */
  game: SportNoun;
  /** A participant knocked out of an event (`ELIMINATED`): "Cut" for golf. */
  eliminated: string;
  /** A participant withdrawn from an event (`WITHDRAWN`): "Scratched" for horse racing. */
  withdrawn: string;
  /** The moment entries close, read after "the": "first tee time" for golf. */
  eventStart: string;
  /** Play after regulation, read after "Final, ": "extra time" for soccer, else "overtime". */
  overtime: string;
  /** A game that ends level: "Draw" for soccer, else "Tie". */
  tie: string;
  /** What one match's score counts, as a tiebreaker reads it: "sets" for tennis, else "points". */
  scoreUnit: string;
  /** Who rides each participant, as a result column: "Rider" for horse racing; absent elsewhere. */
  rider?: string;
  /** The first three finishing places: "Win / Place / Show" for horse racing; absent elsewhere. */
  topPlaces?: string;
  /** What a result's shoot-out is called after its scores: "pens" for soccer; absent elsewhere. */
  shootout?: string;
}

/** A noun role's singular and plural, in the reader's language. */
export function sportNoun(source: SportWordSource, role: SportNounRole, locale?: string | null): SportNoun {
  return { one: sportWord(source, role, { count: 1, locale }), many: sportWord(source, role, { count: 2, locale }) };
}

/**
 * Every sport word of a sport, or of a sport league definition, in the reader's language.
 */
export function sportVocabulary(source: SportWordSource, locale?: string | null): SportVocabulary {
  const word = { locale };
  return {
    participant: sportNoun(source, 'participant', locale),
    event: sportNoun(source, 'event', locale),
    sportLeague: sportNoun(source, 'sportLeague', locale),
    round: sportNoun(source, 'round', locale),
    match: sportNoun(source, 'match', locale),
    game: sportNoun(source, 'game', locale),
    eliminated: sportWord(source, 'eliminated', word),
    withdrawn: sportWord(source, 'withdrawn', word),
    eventStart: sportWord(source, 'eventStart', word),
    overtime: sportWord(source, 'overtime', word),
    tie: sportWord(source, 'tie', word),
    scoreUnit: sportWord(source, 'scoreUnit', word),
    rider: sportWord(source, 'rider', word),
    topPlaces: sportWord(source, 'topPlaces', word),
    shootout: sportWord(source, 'shootout', word),
  };
}
