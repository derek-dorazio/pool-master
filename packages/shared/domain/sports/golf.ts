import { displayString } from '../../display-strings/display-strings';
import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

export const golfSportDefinition: SportDefinition = {
  sport: Sport.GOLF,
  name: 'Golf',
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.STROKE_PLAY,
  tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
  defaultRounds: 4,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['GOLF_RELATIVE_TO_PAR_TOTAL'],
  shootout: false,
  roundLabel: (roundNumber, _roundCount, locale) => displayString('word.roundNumber', { n: roundNumber }, locale),
};
