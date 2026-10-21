/**
 * Knockout brackets as `SportEventMatch` rows, for the bracket-pool tests (#721).
 *
 * Field row ids name the team so a test reads as a bracket: `T1`..`T8` are seeds 1 to 8, and in
 * the NFL-shaped playoff `AFC-1` is the AFC's 1 seed. Match ids are `m<matchNumber>`.
 *
 * Scaffolding only: no assertions and no test-specific results here.
 */
import {
  MatchSide,
  MatchStatus,
  PredictedResult,
  parseContestScoringSettings,
  type KnockoutRoundPointsSettings,
  type ParticipantContestScoringRule,
  type SportEventMatch,
  type TeamChoice,
} from '@poolmaster/shared/domain';

const T0 = new Date('2027-01-01T00:00:00.000Z');

export interface BracketMatchSpec {
  matchNumber: number;
  round: number;
  home: string | null;
  away: string | null;
  region?: string | null;
  advancesTo?: { matchNumber: number; side: MatchSide };
}

export function bracketMatches(sportEventId: string, specs: readonly BracketMatchSpec[]): SportEventMatch[] {
  return specs.map((spec) => ({
    id: `m${spec.matchNumber}`,
    sportEventId,
    roundNumber: spec.round,
    matchNumber: spec.matchNumber,
    homeSportEventParticipantId: spec.home,
    awaySportEventParticipantId: spec.away,
    isNeutralSite: false,
    scheduledDate: null,
    status: MatchStatus.SCHEDULED,
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    homeShootoutScore: null,
    awayShootoutScore: null,
    advancesToMatchId: spec.advancesTo ? `m${spec.advancesTo.matchNumber}` : null,
    advancesToSide: spec.advancesTo?.side ?? null,
    regionLabel: spec.region ?? null,
    homeSpread: null,
    periodScores: [],
    createdAt: T0,
    updatedAt: T0,
  }));
}

const { HOME, AWAY } = MatchSide;

/**
 * Eight seeded teams over three rounds, every game linked to the next: 1v8 and 4v5 feed game 5,
 * 2v7 and 3v6 feed game 6, and games 5 and 6 feed the final, game 7.
 */
export function eightTeamBracket(sportEventId = 'event-bracket'): SportEventMatch[] {
  return bracketMatches(sportEventId, [
    { matchNumber: 1, round: 1, home: 'T1', away: 'T8', advancesTo: { matchNumber: 5, side: HOME } },
    { matchNumber: 2, round: 1, home: 'T4', away: 'T5', advancesTo: { matchNumber: 5, side: AWAY } },
    { matchNumber: 3, round: 1, home: 'T2', away: 'T7', advancesTo: { matchNumber: 6, side: HOME } },
    { matchNumber: 4, round: 1, home: 'T3', away: 'T6', advancesTo: { matchNumber: 6, side: AWAY } },
    { matchNumber: 5, round: 2, home: null, away: null, advancesTo: { matchNumber: 7, side: HOME } },
    { matchNumber: 6, round: 2, home: null, away: null, advancesTo: { matchNumber: 7, side: AWAY } },
    { matchNumber: 7, round: 3, home: null, away: null },
  ]);
}

/**
 * Six teams over three rounds, the top two seeds on a bye: 4v5 and 3v6 play first, and their
 * winners visit T1 (game 3) and T2 (game 4), who are placed straight into round 2.
 */
export function sixTeamByeBracket(sportEventId = 'event-bye'): SportEventMatch[] {
  return bracketMatches(sportEventId, [
    { matchNumber: 1, round: 1, home: 'T4', away: 'T5', advancesTo: { matchNumber: 3, side: AWAY } },
    { matchNumber: 2, round: 1, home: 'T3', away: 'T6', advancesTo: { matchNumber: 4, side: AWAY } },
    { matchNumber: 3, round: 2, home: 'T1', away: null, advancesTo: { matchNumber: 5, side: HOME } },
    { matchNumber: 4, round: 2, home: 'T2', away: null, advancesTo: { matchNumber: 5, side: AWAY } },
    { matchNumber: 5, round: 3, home: null, away: null },
  ]);
}

/** Seeds 1 to 8 for `T1`..`T8`. */
export const EIGHT_SEEDS: ReadonlyMap<string, number | null> = new Map(
  [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => [`T${seed}`, seed] as const),
);

/** Seeds 1 to 7 in each conference, for the NFL-shaped playoff. */
export const NFL_SEEDS: ReadonlyMap<string, number | null> = new Map(
  ['AFC', 'NFC'].flatMap((conference) => [1, 2, 3, 4, 5, 6, 7].map((seed) => [`${conference}-${seed}`, seed] as const)),
);

/**
 * An NFL-shaped playoff: seven seeds in each conference, the 1 seed on a bye, Wild Card games that
 * link nowhere (so the Divisional round is reseeded), and conference championships and a Super
 * Bowl fed by links.
 */
export function nflPlayoff(sportEventId = 'event-nfl'): SportEventMatch[] {
  return bracketMatches(sportEventId, [
    { matchNumber: 1, round: 1, home: 'AFC-2', away: 'AFC-7', region: 'AFC' },
    { matchNumber: 2, round: 1, home: 'AFC-3', away: 'AFC-6', region: 'AFC' },
    { matchNumber: 3, round: 1, home: 'AFC-4', away: 'AFC-5', region: 'AFC' },
    { matchNumber: 4, round: 1, home: 'NFC-2', away: 'NFC-7', region: 'NFC' },
    { matchNumber: 5, round: 1, home: 'NFC-3', away: 'NFC-6', region: 'NFC' },
    { matchNumber: 6, round: 1, home: 'NFC-4', away: 'NFC-5', region: 'NFC' },
    { matchNumber: 7, round: 2, home: 'AFC-1', away: null, region: 'AFC', advancesTo: { matchNumber: 11, side: HOME } },
    { matchNumber: 8, round: 2, home: null, away: null, region: 'AFC', advancesTo: { matchNumber: 11, side: AWAY } },
    { matchNumber: 9, round: 2, home: 'NFC-1', away: null, region: 'NFC', advancesTo: { matchNumber: 12, side: HOME } },
    { matchNumber: 10, round: 2, home: null, away: null, region: 'NFC', advancesTo: { matchNumber: 12, side: AWAY } },
    { matchNumber: 11, round: 3, home: null, away: null, region: 'AFC', advancesTo: { matchNumber: 13, side: HOME } },
    { matchNumber: 12, round: 3, home: null, away: null, region: 'NFC', advancesTo: { matchNumber: 13, side: AWAY } },
    { matchNumber: 13, round: 4, home: null, away: null },
  ]);
}

/** A game's result as an admin enters it. */
export interface GameResult {
  /** The sides, when the admin places them with the result (a later round's game). */
  home?: string;
  away?: string;
  winner: MatchSide;
  homeScore?: number;
  awayScore?: number;
}

/** The bracket with these games played, by match number; the others are left as they are. */
export function withResults(bracket: readonly SportEventMatch[], results: ReadonlyMap<number, GameResult>): SportEventMatch[] {
  return bracket.map((match) => {
    const result = results.get(match.matchNumber);
    if (result === undefined) return match;
    return {
      ...match,
      homeSportEventParticipantId: result.home ?? match.homeSportEventParticipantId,
      awaySportEventParticipantId: result.away ?? match.awaySportEventParticipantId,
      status: MatchStatus.COMPLETED,
      winnerSide: result.winner,
      homeScore: result.homeScore ?? null,
      awayScore: result.awayScore ?? null,
    };
  });
}

/** One bracket pick: the team (field row id) an entry says wins game `m<matchNumber>`. */
export function bracketPick(matchNumber: number, team: string): { sportEventMatchId: string } & TeamChoice {
  return { sportEventMatchId: `m${matchNumber}`, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team };
}

/** A contest configuration's knockout round-points rule, read back as the adapter reads it. */
export function knockoutScoringRule(contestConfigurationId: string, config: KnockoutRoundPointsSettings): ParticipantContestScoringRule {
  return {
    id: `rule-${contestConfigurationId}`,
    contestConfigurationId,
    sortOrder: 1,
    active: true,
    scoring: parseContestScoringSettings('KNOCKOUT_ROUND_POINTS', config),
    createdAt: T0,
    updatedAt: T0,
  };
}
