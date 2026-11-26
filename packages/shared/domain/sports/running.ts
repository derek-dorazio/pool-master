import { SelectionType, Sport, TournamentFormat } from '../enums';
import type { SportDefinition } from './sport-definition';

/**
 * Running (#627, plans/racing-sports.md §5): road racing on foot, the World Marathon Majors first,
 * scored by finishing place from the contest's points table. A marathon is one race with one
 * result, the official finishing order of its elite field. Each series (World Marathon Majors
 * (men), World Marathon Majors (women)) is a sport league with its own Top 10 presets as contest
 * templates. Odds are thin, so a field is tiered by its World Athletics ranking and priced by seed;
 * odds are optional. The result names only the runner, so there is no rider column, and no name
 * for the top places. A runner who drops out is a DNF on the finishing order, not a knock-out, so
 * there is no word for that either.
 */
export const runningSportDefinition: SportDefinition = {
  sport: Sport.RUNNING,
  name: 'Running',
  tournamentFormat: TournamentFormat.RACE,
  defaultRounds: 1,
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['FINISH_POSITION_POINTS'],
  shootout: false,
  // An event run as several numbered races would read "Race 2".
};
