import { Sport, type SelectionType } from '../enums';
import { autoRacingSportDefinition } from './auto-racing';
import { golfSportDefinition } from './golf';
import { horseRacingSportDefinition } from './horse-racing';
import type { SportDefinition } from './sport-definition';

/**
 * The sport registry: a sport is supported when it is here, and nowhere else decides it.
 * Exhaustive over `Sport`, so a sport added to the enum fails the build until it has a
 * definition. Follow the `add-sport` skill to add one.
 */
export const SPORT_DEFINITIONS: Readonly<Record<Sport, SportDefinition>> = {
  [Sport.GOLF]: golfSportDefinition,
  [Sport.HORSE_RACING]: horseRacingSportDefinition,
  [Sport.AUTO_RACING]: autoRacingSportDefinition,
};

/** Every supported sport, in enum order. */
export const SUPPORTED_SPORTS: readonly Sport[] = Object.values(Sport);

export function getSportDefinition(sport: Sport): SportDefinition {
  return SPORT_DEFINITIONS[sport];
}

/** Whether a commissioner may run a contest of this selection type in the definition's sport. */
export function sportAllowsSelectionType(definition: SportDefinition, selectionType: SelectionType): boolean {
  return definition.selectionTypes.includes(selectionType);
}
