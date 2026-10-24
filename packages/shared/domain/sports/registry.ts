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
import { soccerSportDefinition } from './soccer';
import { tennisSportDefinition } from './tennis';
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
  [Sport.SOCCER]: soccerSportDefinition,
  [Sport.TENNIS]: tennisSportDefinition,
};

/** Every supported sport, in enum order. */
export const SUPPORTED_SPORTS: readonly Sport[] = Object.values(Sport);

/**
 * Where each sport sits wherever sports are listed for people choosing one, as on How to Play:
 * the most popular first, the ancillary sports (cycling, running) last. Lower comes first.
 * Exhaustive over `Sport`, so a new sport fails the build until it has a place.
 */
const SPORT_POPULARITY_RANK: Readonly<Record<Sport, number>> = {
  [Sport.AMERICAN_FOOTBALL]: 1,
  [Sport.BASKETBALL]: 2,
  [Sport.BASEBALL]: 3,
  [Sport.HOCKEY]: 4,
  [Sport.SOCCER]: 5,
  [Sport.GOLF]: 6,
  [Sport.AUTO_RACING]: 7,
  [Sport.TENNIS]: 8,
  [Sport.HORSE_RACING]: 9,
  [Sport.CYCLING]: 10,
  [Sport.RUNNING]: 11,
};

/** Every supported sport, the most popular first. */
export const SPORTS_BY_POPULARITY: readonly Sport[] = [...SUPPORTED_SPORTS]
  .sort((left, right) => SPORT_POPULARITY_RANK[left] - SPORT_POPULARITY_RANK[right]);

export function getSportDefinition(sport: Sport): SportDefinition {
  return SPORT_DEFINITIONS[sport];
}

/** Whether a commissioner may run a contest of this selection type in the definition's sport. */
export function sportAllowsSelectionType(definition: SportDefinition, selectionType: SelectionType): boolean {
  return definition.selectionTypes.includes(selectionType);
}

/**
 * A sport as a URL segment, as the root admin's Manage pages and the emails linking to them
 * spell it: `GOLF` reads `golf`, `HORSE_RACING` reads `horse-racing`. Derived from the enum
 * value, so every sport has one and no two share one.
 */
export function sportPathSegment(sport: Sport): string {
  return sport.toLowerCase().replace(/_/g, '-');
}
