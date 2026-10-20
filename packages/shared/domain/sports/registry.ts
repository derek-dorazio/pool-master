import { Sport, type SelectionType } from '../enums';
import { americanFootballSportDefinition } from './american-football';
import { autoRacingSportDefinition } from './auto-racing';
import { baseballSportDefinition } from './baseball';
import { basketballSportDefinition } from './basketball';
import { cyclingSportDefinition } from './cycling';
import { golfSportDefinition } from './golf';
import { hockeySportDefinition } from './hockey';
import { horseRacingSportDefinition } from './horse-racing';
import { runningSportDefinition } from './running';
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
  [Sport.CYCLING]: cyclingSportDefinition,
  [Sport.RUNNING]: runningSportDefinition,
  [Sport.BASKETBALL]: basketballSportDefinition,
  [Sport.AMERICAN_FOOTBALL]: americanFootballSportDefinition,
  [Sport.HOCKEY]: hockeySportDefinition,
  [Sport.BASEBALL]: baseballSportDefinition,
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
