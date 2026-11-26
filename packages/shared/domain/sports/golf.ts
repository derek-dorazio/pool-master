import { SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

export const golfSportDefinition: SportDefinition = {
  sport: Sport.GOLF,
  name: 'Golf',
  tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
  defaultRounds: 4,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['GOLF_RELATIVE_TO_PAR_TOTAL'],
};
