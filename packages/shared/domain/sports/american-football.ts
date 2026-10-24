import { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';
import { SportStat, statValue, type SportComposite } from './sport-stats';

/** What the rounds of a playoff bracket are called, counted back from the final. */
const ROUND_NAMES_FROM_FINAL = ['Super Bowl', 'Conference Championship', 'Divisional', 'Wild Card'] as const;

/** The stats Redzone counts. */
const AMERICAN_FOOTBALL_STATS = [SportStat.PASSING_TOUCHDOWNS, SportStat.RUSHING_TOUCHDOWNS, SportStat.RECEIVING_TOUCHDOWNS, SportStat.RECEPTIONS, SportStat.PASSING_YARDS, SportStat.RUSHING_YARDS, SportStat.RECEIVING_YARDS] as const;
/** One of Redzone's stats: american football's typed slice of `SportStat`. */
type AmericanFootballStat = (typeof AMERICAN_FOOTBALL_STATS)[number];

/** Redzone (#932): 6 x touchdowns (passing, rushing and receiving) + receptions + passing and
 * scrimmage yards / 10, rounded down, a game's. Each NFL stat pool event is one week's games, so one round. */
const americanFootballComposite: SportComposite<AmericanFootballStat> = {
  name: 'Redzone',
  stats: AMERICAN_FOOTBALL_STATS,
  defaultGames: 1,
  score: (line) => 6 * (statValue(line, SportStat.PASSING_TOUCHDOWNS) + statValue(line, SportStat.RUSHING_TOUCHDOWNS) + statValue(line, SportStat.RECEIVING_TOUCHDOWNS))
    + statValue(line, SportStat.RECEPTIONS)
    + Math.floor((statValue(line, SportStat.PASSING_YARDS) + statValue(line, SportStat.RUSHING_YARDS) + statValue(line, SportStat.RECEIVING_YARDS)) / 10),
};

/**
 * American football (#702, plans/knockout-and-pickem-design.md §3.5): teams playing a knockout
 * bracket, scored by the head-to-head family from the bracket's matches. A regular-season week
 * is its own event of one round whose games form no bracket (#715), for pick'em contests. The NFL is its sport
 * league, and reseeds after Wild Card weekend and again after the Divisional round
 * (BracketAdvancement.RESEED_BY_SEED, #722), so the best seed left always hosts.
 *
 * The NFL playoffs are 14 teams in four rounds, seven seeds in each conference with the 1 seed on
 * a bye; a bye scores nothing. The field falls into seven tiers of two, assigned like any sport's
 * from odds or ranking.
 *
 * The College Football Playoff is a second sport league (#707): a fixed bracket of 12 teams in
 * four rounds, the top four seeds on byes into the quarterfinals. It names its own rounds and
 * starts its events on six tiers of two (`SportLeague.roundNames`, `SportLeague.tierCount`), so
 * the names and tier layout below are the NFL's.
 */
export const americanFootballSportDefinition: SportDefinition = {
  sport: Sport.AMERICAN_FOOTBALL,
  name: 'American football',
  participantType: ParticipantType.TEAM,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 4,
  defaultTierLayout: { tierCount: 7, tierSize: 2 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR, SelectionType.SQUARES],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  shootout: null,
  composite: americanFootballComposite,
  matchPeriodLayout: MatchPeriodLayout.QUARTERS,
  pickEm: { tiePicks: false, againstTheSpread: true },
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'playoffs', many: 'playoffs' },
    sportLeague: { one: 'league', many: 'leagues' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'first kickoff',
    match: { one: 'game', many: 'games' },
    tie: 'Tie',
  },
  // A four-round bracket reads Wild Card, Divisional, Conference Championship, Super Bowl; a
  // shorter one keeps the names counted back from its final.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    const name = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return name ?? `Round ${roundNumber}`;
  },
};
