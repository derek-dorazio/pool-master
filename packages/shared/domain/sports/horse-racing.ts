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
  // Favourites, the middle of the market, and the longshots: three tiers, three horses in each of
  // the first two and the rest of the field in the last, so an 8-runner field fills all three.
  defaultTierLayout: { tierCount: 3, tierSize: 3 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  shootout: null,
  composite: null,
  vocabulary: {
    participant: { one: 'horse', many: 'horses' },
    event: { one: 'race', many: 'races' },
    // Racing is run country by country, so a sport league is a racing circuit (plans/racing-sports.md §2.2).
    sportLeague: { one: 'circuit', many: 'circuits' },
    round: { one: 'race', many: 'races' },
    withdrawn: 'Scratched',
    eventStart: 'post time',
    rider: 'Rider',
    topPlaces: 'Win / Place / Show',
  },
  // A horse race is one race; a meeting run as several numbered races would read "Race 2".
  roundLabel: (roundNumber, roundCount) => (roundCount > 1 ? `Race ${roundNumber}` : 'Race'),
};
