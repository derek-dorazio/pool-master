import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/**
 * Cycling (#626, plans/racing-sports.md §4): road racing, scored by the final overall
 * classification from the contest's points table. A Grand Tour is one event with one result, the
 * final overall order entered after the last stage, so its stages are not rounds; a one-day race
 * has the same shape. Each tour (UCI WorldTour, UCI Women's WorldTour) is a sport league with its
 * own Top 10 presets as contest templates. The result names only the rider, so there is no rider
 * column, and no name for the top places. A rider who abandons is a DNF on the finishing order,
 * not a knock-out, so there is no word for that either.
 */
export const cyclingSportDefinition: SportDefinition = {
  sport: Sport.CYCLING,
  name: 'Cycling',
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.FINISH_POSITION,
  tournamentFormat: TournamentFormat.RACE,
  defaultRounds: 1,
  // Five tiers of ten: four tiers of contenders hold 40 riders, and the last tier takes the rest of
  // a Grand Tour field of about 175.
  defaultTierLayout: { tierCount: 5, tierSize: 10 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  vocabulary: {
    participant: { one: 'rider', many: 'riders' },
    event: { one: 'race', many: 'races' },
    sportLeague: { one: 'tour', many: 'tours' },
    round: { one: 'race', many: 'races' },
    withdrawn: 'Withdrawn',
    // Copy reads "Entries close at the start", so the word carries no article of its own.
    eventStart: 'start',
  },
  // An event run as several numbered races would read "Race 2".
  roundLabel: (roundNumber, roundCount) => (roundCount > 1 ? `Race ${roundNumber}` : 'Race'),
};
