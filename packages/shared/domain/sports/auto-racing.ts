import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/**
 * Auto racing (#624, plans/racing-sports.md §3): car racing, one race per event, a field of up to
 * 40 cars, scored by finishing place from the contest's points table. Each series (NASCAR Cup
 * Series, IndyCar, and Formula 1 from #625) is a sport league with its own official points presets
 * as contest templates.
 * The result names only the driver, so there is no rider column, and no name for the top places.
 * Nobody is knocked out partway through a race, so there is no word for it either.
 */
export const autoRacingSportDefinition: SportDefinition = {
  sport: Sport.AUTO_RACING,
  name: 'Auto racing',
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.FINISH_POSITION,
  tournamentFormat: TournamentFormat.RACE,
  defaultRounds: 1,
  // Five tiers of eight: a full NASCAR field of 40 fills them exactly, and the 33-car Indy 500
  // field leaves the last tier the short one (8/8/8/8/1). A Formula 1 field of about 22 is set to
  // four tiers on the event's Tiers card instead, and auto-assign spreads it evenly (6/6/5/5).
  defaultTierLayout: { tierCount: 5, tierSize: 8 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  shootout: null,
  vocabulary: {
    participant: { one: 'driver', many: 'drivers' },
    event: { one: 'race', many: 'races' },
    sportLeague: { one: 'series', many: 'series' },
    round: { one: 'race', many: 'races' },
    withdrawn: 'Withdrawn',
    eventStart: 'green flag',
  },
  // A race weekend run as several numbered races would read "Race 2".
  roundLabel: (roundNumber, roundCount) => (roundCount > 1 ? `Race ${roundNumber}` : 'Race'),
};
