import { SelectionType, Sport } from '../enums';
import type { SportDefinition } from './sport-definition';

export const golfSportDefinition: SportDefinition = {
  sport: Sport.GOLF,
  name: 'Golf',
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['GOLF_RELATIVE_TO_PAR_TOTAL'],
};
