import { displayString } from '../../display-strings/display-strings';
import { SelectionType, Sport, TournamentFormat } from '../enums';
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
  tournamentFormat: TournamentFormat.RACE,
  defaultRounds: 1,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  shootout: false,
  // An event run as several numbered races would read "Race 2".
  roundLabel: (roundNumber, roundCount, locale) => (roundCount > 1 ? displayString('word.raceNumber', { n: roundNumber }, locale) : displayString('word.singleRace', undefined, locale)),
};
