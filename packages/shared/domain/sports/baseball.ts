import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/** What the rounds of an MLB postseason are called, counted back from the World Series. */
const ROUND_NAMES_FROM_FINAL = ['World Series', 'League Championship Series', 'Division Series', 'Wild Card Series'] as const;

/**
 * Baseball (#789): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball and hockey are. Its one sport league is the MLB postseason,
 * where every round is a series: one bracket match whose scores are the games each side won.
 *
 * Twelve teams in four rounds, four tiers of three. Each league's top two seeds skip the Wild Card
 * Series and start in the Division Series, named straight into their match as the CFP's byes
 * are. A final that is a series has no single game for a squares pool, and baseball keeps no
 * score by period, so it offers no squares.
 */
export const baseballSportDefinition: SportDefinition = {
  sport: Sport.BASEBALL,
  name: 'Baseball',
  participantType: ParticipantType.TEAM,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  defaultTierLayout: { tierCount: 4, tierSize: 3 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'postseason', many: 'postseasons' },
    sportLeague: { one: 'league', many: 'leagues' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'first pitch',
    match: { one: 'series', many: 'series' },
  },
  // A four-round postseason reads Wild Card Series, Division Series, League Championship Series,
  // World Series; a shorter one keeps the names counted back from its final.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    const name = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return name ?? `Round ${roundNumber}`;
  },
};
