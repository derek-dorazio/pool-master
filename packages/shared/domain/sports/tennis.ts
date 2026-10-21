import { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import { ScoringFamily } from './scoring-family';
import type { SportDefinition } from './sport-definition';

/** The last three rounds of any draw, counted back from the final. */
const LAST_ROUND_NAMES = ['Final', 'Semifinals', 'Quarterfinals'] as const;

/** The rounds before the quarterfinals, named by number from the first. */
const EARLY_ROUND_NAMES = ['First round', 'Second round', 'Third round', 'Fourth round'] as const;

/**
 * Tennis (#704): individuals playing a knockout draw, scored by the head-to-head family from the
 * draw's matches, as the team sports are. Its sport leagues are the ATP (men's singles) and the
 * WTA (women's singles), split as every other sport's men's and women's competitions are; each
 * holds the four Grand Slams as event series. The NCAA Division I men's and women's singles
 * championships are two more, each a 64-player draw in six rounds with its own round names. A Slam singles draw is 128 players in seven rounds,
 * 32 of them seeded; a match's score is sets won, and a match can end early (a retirement, a
 * walkover or a default) with its winner winning in full.
 *
 * The draw's 16 qualifier places are play-in places (#709), filled once qualifying ends. The
 * field is cut into six tiers of eight by ranking, the last taking everyone else, so the first
 * four tiers are the 32 seeds. There are no periods, so no squares, and no pick'em.
 */
export const tennisSportDefinition: SportDefinition = {
  sport: Sport.TENNIS,
  name: 'Tennis',
  participantType: ParticipantType.INDIVIDUAL,
  scoringFamily: ScoringFamily.HEAD_TO_HEAD,
  tournamentFormat: TournamentFormat.MATCHES,
  defaultRounds: 7,
  defaultTierLayout: { tierCount: 6, tierSize: 8 },
  selectionTypes: [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW, SelectionType.BRACKET, SelectionType.SURVIVOR],
  scoringDefinitions: ['KNOCKOUT_ROUND_POINTS'],
  // A tennis match always has a winner: no level score to settle.
  shootout: null,
  vocabulary: {
    participant: { one: 'player', many: 'players' },
    event: { one: 'draw', many: 'draws' },
    sportLeague: { one: 'tour', many: 'tours' },
    round: { one: 'round', many: 'rounds' },
    eliminated: 'Out',
    withdrawn: 'Withdrawn',
    eventStart: 'first match',
    match: { one: 'match', many: 'matches' },
    tie: 'Tie',
    playInPlace: 'qualifier',
    scoreUnit: 'sets',
  },
  // A Slam's seven rounds read First round to Fourth round, then Quarterfinals, Semifinals,
  // Final; a 64 draw's six the same, with no Fourth round.
  roundLabel: (roundNumber, roundCount) => {
    const fromFinal = roundCount - roundNumber;
    if (fromFinal < 0) return `Round ${roundNumber}`;
    const name = fromFinal < LAST_ROUND_NAMES.length ? LAST_ROUND_NAMES[fromFinal] : EARLY_ROUND_NAMES.at(roundNumber - 1);
    return name ?? `Round ${roundNumber}`;
  },
};
