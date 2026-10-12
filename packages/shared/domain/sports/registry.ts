import { Sport } from '../enums';
import { golfSportDefinition } from './golf';
import type { SportDefinition } from './sport-definition';

/**
 * The sport registry: a sport is supported when it is here, and nowhere else decides it.
 * Exhaustive over `Sport`, so a sport added to the enum fails the build until it has a
 * definition. Follow the `add-sport` skill to add one.
 */
export const SPORT_DEFINITIONS: Readonly<Record<Sport, SportDefinition>> = {
  [Sport.GOLF]: golfSportDefinition,
};

/** Every supported sport, in enum order. */
export const SUPPORTED_SPORTS: readonly Sport[] = Object.values(Sport);

export function getSportDefinition(sport: Sport): SportDefinition {
  return SPORT_DEFINITIONS[sport];
}
