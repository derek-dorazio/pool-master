import { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/** What the rounds of a college hockey bracket are called, counted back from the final. */
const ROUND_NAMES_FROM_FINAL = ['National Championship', 'Frozen Four', 'Regional Finals', 'Regional Semifinals'] as const;

/**
 * Hockey (#788): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball is. Its sport leagues are the NHL and PWHL playoffs, where a
 * series is one match whose scores are the games each side won, and the NCAA Division I men's
 * and women's tournaments, single games whose scores are goals. The NHL, the PWHL and the women's
 * tournament name their own rounds (`SportLeague.roundNames`), so the names below are the men's
 * tournament's. A game is three periods; overtime goals count only in the final score.
 *
 * The NHL and the men's tournament are 16 teams in four rounds, four tiers of four. The women's
 * tournament seeds five teams and fills three quarterfinal places from a first round, through
 * play-in places as March Madness's First Four does. The PWHL's four teams start on two tiers
 * (`SportLeague.tierCount`).
 */
export const hockeySportDefinition: SportDefinition = {
  sport: Sport.HOCKEY,
  name: 'Hockey',
  participantType: ParticipantType.TEAM,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  defaultTierLayout: { tierCount: 4, tierSize: 4 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // Playoff games play overtime to a goal, so none ends in a shoot-out (#791).
  shootout: null,
  matchPeriodLayout: MatchPeriodLayout.THREE_PERIODS,
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'playoffs', many: 'playoffs' },
    sportLeague: { one: 'league', many: 'leagues' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'opening puck drop',
    match: { one: 'game', many: 'games' },
    tie: 'Tie',
  },
  // A four-round bracket reads Regional Semifinals, Regional Finals, Frozen Four, National
  // Championship; a shorter one keeps the names counted back from its final.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    const name = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return name ?? `Round ${roundNumber}`;
  },
};
