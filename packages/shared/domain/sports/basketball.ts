import { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/** What the last rounds of a basketball bracket are called, counted back from the final. */
const ROUND_NAMES_FROM_FINAL = ['National Championship', 'Final Four', 'Elite Eight', 'Sweet 16'] as const;
/** What the opening rounds are called, before the named ones. */
const OPENING_ROUND_NAMES = ['First Round', 'Second Round', 'Third Round'] as const;

/**
 * Basketball (#698, plans/knockout-and-pickem-design.md §3.5): teams playing a knockout bracket,
 * scored by the head-to-head family from the bracket's matches. The NCAA Division I men's and
 * women's tournaments are its sport leagues, and the NBA and WNBA playoffs are two more (#706): a
 * series is one match, its scores the games each side won, and those leagues name their own
 * rounds (`SportLeague.roundNames`, read through `eventRoundLabel`), so the names below are
 * March Madness's. The NBA play-in fills the 7 and 8 seeds through play-in places, as the First
 * Four does.
 *
 * The March Madness field is 64 bracket places in six rounds: the First Four play-in winners
 * fill their places through one combined field member each, not through play-in matches. Four
 * tiers of 16 are the seed lines (seeds 1-4, 5-8, 9-12 and 13-16 across the four regions), in
 * the field's overall ranking order.
 */
export const basketballSportDefinition: SportDefinition = {
  sport: Sport.BASKETBALL,
  name: 'Basketball',
  participantType: ParticipantType.TEAM,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 6,
  defaultTierLayout: { tierCount: 4, tierSize: 16 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // Quarters, as the NBA, the WNBA and women's college basketball play; men's college basketball
  // plays halves (its sport league's `matchPeriodLayout`).
  matchPeriodLayout: MatchPeriodLayout.QUARTERS,
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'tournament', many: 'tournaments' },
    sportLeague: { one: 'league', many: 'leagues' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'opening tip-off',
    match: { one: 'game', many: 'games' },
  },
  // A six-round bracket reads First Round, Second Round, Sweet 16, Elite Eight, Final Four,
  // National Championship; a shorter one keeps the names counted back from its final.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    // A stored round past the count (the count was lowered) has no name from the final: `at` would
    // read a negative index from the end.
    const fromFinalName = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return fromFinalName ?? OPENING_ROUND_NAMES.at(roundNumber - 1) ?? `Round ${roundNumber}`;
  },
};
