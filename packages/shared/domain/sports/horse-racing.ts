import { displayString } from '../../display-strings/display-strings';
import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/**
 * Horse racing (#623, plans/racing-sports.md §2.1): one race per event, a field of 8 to 20
 * horses, scored by finishing place from the contest's points table (Win / Place / Show by
 * default). Nobody is knocked out partway through a race, so there is no word for it; a horse
 * withdrawn before the start is "Scratched".
 */
export const horseRacingSportDefinition: SportDefinition = {
  sport: Sport.HORSE_RACING,
  name: 'Horse racing',
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.FINISH_POSITION,
  tournamentFormat: TournamentFormat.RACE,
  defaultRounds: 1,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  shootout: false,
  composite: null,
  // A horse race is one race; a meeting run as several numbered races would read "Race 2".
  roundLabel: (roundNumber, roundCount, locale) => (roundCount > 1 ? displayString('word.raceNumber', { n: roundNumber }, locale) : displayString('word.singleRace', undefined, locale)),
};
