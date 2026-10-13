import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

export const golfSportDefinition: SportDefinition = {
  sport: Sport.GOLF,
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.STROKE_PLAY,
  tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['GOLF_RELATIVE_TO_PAR_TOTAL'],
  vocabulary: {
    participant: { one: 'golfer', many: 'golfers' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Cut',
    eventStart: 'first tee time',
  },
  roundLabel: (roundNumber) => `Round ${roundNumber}`,
};
