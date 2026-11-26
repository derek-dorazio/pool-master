import { displayString } from './display-strings';

/**
 * What a tier of an event's field is called on every screen and email that shows one (#2047):
 * "Tier 1" is the top tier. A tier is identified by its number and stores no name, so this is the
 * one copy of its words.
 */
export function tierLabel(tierNumber: number): string {
  return displayString('word.tierNumber', { n: tierNumber });
}
