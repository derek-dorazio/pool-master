import { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';
import { SportStat, statValue, type SportComposite } from './sport-stats';

/** What the rounds of a soccer knockout are called, counted back from the final. */
const ROUND_NAMES_FROM_FINAL = ['Final', 'Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32'] as const;

/** The stats Hat Trick counts. */
const SOCCER_STATS = [SportStat.GOALS, SportStat.ASSISTS, SportStat.SHOTS_ON_TARGET] as const;
/** One of Hat Trick's stats: soccer's typed slice of `SportStat`. */
type SoccerStat = (typeof SOCCER_STATS)[number];

/**
 * Hat Trick (#994): 3 x goals + 2 x assists + shots on target, an outfield player's match. Extra
 * time counts; a shoot-out does not. The name may change (Golden Boot was also considered), so
 * this is the one place it is written.
 */
const soccerComposite: SportComposite<SoccerStat> = {
  name: 'Hat Trick',
  stats: SOCCER_STATS,
  defaultGames: 1,
  score: (line) => 3 * statValue(line, SportStat.GOALS) + 2 * statValue(line, SportStat.ASSISTS) + statValue(line, SportStat.SHOTS_ON_TARGET),
};

/**
 * Soccer (#787): teams playing a knockout bracket, scored by the head-to-head family from the
 * bracket's matches, as basketball and hockey are. Its sport leagues are the FIFA World Cup and
 * Women's World Cup, the UEFA European Championship, the Copa América and the UEFA Champions
 * League, each event its knockout stage. A match's score is the score after extra time (IFAB
 * Law 10); one level after extra time goes to penalties, kept apart as the match's shoot-out
 * (#791). A Champions League two-legged tie is one match whose score is the aggregate, kicking
 * off at the first leg; the league names its own rounds (`SportLeague.roundNames`).
 *
 * A knockout stage of 16 is four rounds, four tiers of four, seeded by FIFA ranking for the
 * international tournaments and by league-phase place for the Champions League. A match is two
 * halves; extra-time goals count only in the final score.
 */
export const soccerSportDefinition: SportDefinition = {
  sport: Sport.SOCCER,
  name: 'Soccer',
  participantType: ParticipantType.TEAM,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  defaultTierLayout: { tierCount: 4, tierSize: 4 },
  selectionTypes: [
    SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES,
  ],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // A pick'em pick may be a draw (#792); soccer has no spread to pick against.
  pickEm: { tiePicks: true, againstTheSpread: false },
  shootout: { label: 'pens' },
  composite: soccerComposite,
  matchPeriodLayout: MatchPeriodLayout.HALVES,
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'tournament', many: 'tournaments' },
    sportLeague: { one: 'competition', many: 'competitions' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'first kickoff',
    match: { one: 'match', many: 'matches' },
    overtime: 'extra time',
    tie: 'Draw',
    scoreUnit: 'goals',
  },
  // A four-round knockout reads Round of 16, Quarter-finals, Semi-finals, Final; a five-round one
  // starts at the Round of 32.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    const name = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return name ?? `Round ${roundNumber}`;
  },
};
