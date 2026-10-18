import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/** What the rounds of a playoff bracket are called, counted back from the final. */
const ROUND_NAMES_FROM_FINAL = ['Super Bowl', 'Conference Championship', 'Divisional', 'Wild Card'] as const;

/**
 * American football (#702, plans/knockout-and-pickem-design.md §3.5): teams playing a knockout
 * bracket, scored by the head-to-head family from the bracket's matches. The NFL is its sport
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
  tournamentFormat: TournamentFormat.KNOCKOUT_BRACKET,
  defaultRounds: 4,
  defaultTierLayout: { tierCount: 7, tierSize: 2 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  vocabulary: {
    participant: { one: 'team', many: 'teams' },
    event: { one: 'playoffs', many: 'playoffs' },
    sportLeague: { one: 'league', many: 'leagues' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Eliminated',
    withdrawn: 'Withdrawn',
    eventStart: 'first kickoff',
    match: { one: 'game', many: 'games' },
  },
  // A four-round bracket reads Wild Card, Divisional, Conference Championship, Super Bowl; a
  // shorter one keeps the names counted back from its final.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    const name = fromFinal >= 0 ? ROUND_NAMES_FROM_FINAL.at(fromFinal) : undefined;
    return name ?? `Round ${roundNumber}`;
  },
};
