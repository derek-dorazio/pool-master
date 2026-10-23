/**
 * Enumerations used across the PoolMaster domain.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active backend
 * refactor plans. Some values remain as deferred catalog entries even when
 * they are no longer part of the first-pass runtime surface.
 */

// --- Sports ---

/**
 * The sports PoolMaster runs contests for. Only built sports are members: a sport arrives
 * with the migration and code that support it (#605), so nothing here is a catalog entry.
 */
export const Sport = {
  GOLF: 'GOLF',
  HORSE_RACING: 'HORSE_RACING',
  AUTO_RACING: 'AUTO_RACING',
  CYCLING: 'CYCLING',
  RUNNING: 'RUNNING',
  BASKETBALL: 'BASKETBALL',
  AMERICAN_FOOTBALL: 'AMERICAN_FOOTBALL',
  HOCKEY: 'HOCKEY',
  BASEBALL: 'BASEBALL',
  SOCCER: 'SOCCER',
  TENNIS: 'TENNIS',
} as const;
export type Sport = (typeof Sport)[keyof typeof Sport];

export const ParticipantType = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const;
export type ParticipantType = (typeof ParticipantType)[keyof typeof ParticipantType];

// --- Participant Status ---

export const ParticipantStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  RETIRED: 'RETIRED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type ParticipantStatus = (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

export const InjuryStatusCode = {
  HEALTHY: 'HEALTHY',
  QUESTIONABLE: 'QUESTIONABLE',
  DOUBTFUL: 'DOUBTFUL',
  OUT: 'OUT',
  WITHDRAWN: 'WITHDRAWN',
  SUSPENDED: 'SUSPENDED',
  SCRATCHED: 'SCRATCHED',
} as const;
export type InjuryStatusCode = (typeof InjuryStatusCode)[keyof typeof InjuryStatusCode];

export const FormTrend = {
  RISING: 'RISING',
  STABLE: 'STABLE',
  FALLING: 'FALLING',
} as const;
export type FormTrend = (typeof FormTrend)[keyof typeof FormTrend];

export const MappingConfidence = {
  EXACT: 'EXACT',
  HIGH: 'HIGH',
  MANUAL: 'MANUAL',
} as const;
export type MappingConfidence = (typeof MappingConfidence)[keyof typeof MappingConfidence];

// --- Contest Pool ---

export const PoolType = {
  EVENT_FIELD: 'EVENT_FIELD',
  CUSTOM: 'CUSTOM',
  RANKING_CUTOFF: 'RANKING_CUTOFF',
  FULL_SPORT: 'FULL_SPORT',
} as const;
export type PoolType = (typeof PoolType)[keyof typeof PoolType];

// --- Contest Structure ---

/**
 * Pool format applied to a contest: how its entries pick and are scored. ROSTER: an entry picks
 * a lineup of participants from the event's field, scored by the sport's family. PREDICTION
 * (#716): an entry picks the winner of each game of an event, scored against the games' results.
 */
export const ContestFormat = {
  ROSTER: 'ROSTER',
  PREDICTION: 'PREDICTION',
  /** A 10x10 grid on one game (#711): entries claim boxes, the digits are drawn, and each scoring moment's box wins. */
  SQUARES: 'SQUARES',
} as const;
export type ContestFormat = (typeof ContestFormat)[keyof typeof ContestFormat];

/** Tournament structural format: decides which contest formats are valid for a sport's events. */
export const TournamentFormat = {
  STROKE_PLAY_TOURNAMENT: 'STROKE_PLAY_TOURNAMENT',
  /** One race: one field, one finishing order (#623). */
  RACE: 'RACE',
  /**
   * Games between two sides (#698; renamed from KNOCKOUT_BRACKET in #715). Whether an event's
   * games form a knockout bracket is read from their links (`advancesToMatchId`): a playoff's do,
   * an NFL regular-season week's don't.
   */
  MATCHES: 'MATCHES',
} as const;
export type TournamentFormat = (typeof TournamentFormat)[keyof typeof TournamentFormat];

/**
 * Where one match of an event stands (#698). A match is COMPLETED once its result is in; a
 * CANCELLED one was never played.
 */
export const MatchStatus = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

/**
 * One side of a match (#698). On a neutral site HOME is the upper line of the bracket; screens
 * say "vs" there and "@" otherwise.
 */
export const MatchSide = {
  HOME: 'HOME',
  AWAY: 'AWAY',
} as const;
export type MatchSide = (typeof MatchSide)[keyof typeof MatchSide];

/**
 * How a match with a result ended (#704 slice 1), in any sport that plays matches. PLAYED: to its
 * end. RETIREMENT: the loser stopped part way, often ahead. WALKOVER: the loser never started.
 * DEFAULT: the loser was disqualified. The winner wins in full every way: scorers read only
 * `winnerSide`, so a walkover's winner advances and earns the round's points.
 */
export const MatchEnding = {
  PLAYED: 'PLAYED',
  RETIREMENT: 'RETIREMENT',
  WALKOVER: 'WALKOVER',
  DEFAULT: 'DEFAULT',
} as const;
export type MatchEnding = (typeof MatchEnding)[keyof typeof MatchEnding];

/**
 * How a sport league's bracket winners reach their next match (#722). FIXED: each match names
 * the match and side its winner moves on to (March Madness, the NBA). RESEED_BY_SEED: after a
 * round whose matches name no next match, the admin places the teams left in each region, the
 * best seed hosting the worst (the NFL after Wild Card weekend).
 */
export const BracketAdvancement = {
  FIXED: 'FIXED',
  RESEED_BY_SEED: 'RESEED_BY_SEED',
} as const;
export type BracketAdvancement = (typeof BracketAdvancement)[keyof typeof BracketAdvancement];

/**
 * The periods one game of a sport league is played in (#786): QUARTERS for American football, the
 * NBA, the WNBA and women's college basketball; HALVES for men's college basketball; THREE_PERIODS
 * for hockey (#788). A sport league with none set plays its sport's layout
 * (`SportDefinition.matchPeriodLayout`).
 */
export const MatchPeriodLayout = {
  QUARTERS: 'QUARTERS',
  HALVES: 'HALVES',
  THREE_PERIODS: 'THREE_PERIODS',
} as const;
export type MatchPeriodLayout = (typeof MatchPeriodLayout)[keyof typeof MatchPeriodLayout];

/**
 * What screens call a sport league when its sport's noun does not fit (#834): the NCAA Division I
 * tennis championships are leagues, where the ATP and the WTA are tours. A sport league with
 * none set takes its sport's (`SportVocabulary.sportLeague`); read through `sportLeagueNounOf`.
 */
export const SportLeagueNoun = {
  LEAGUE: 'LEAGUE',
} as const;
export type SportLeagueNoun = (typeof SportLeagueNoun)[keyof typeof SportLeagueNoun];

/**
 * How one field member's race ended (#622): the finish-position family's result status. Only a
 * FINISHED runner has a finishing place; every other status scores the contest's "did not
 * finish" points. A horse scratched before the start is WITHDRAWN on the field, not here.
 */
export const RaceResultStatus = {
  FINISHED: 'FINISHED',
  DID_NOT_FINISH: 'DID_NOT_FINISH',
  DISQUALIFIED: 'DISQUALIFIED',
  DID_NOT_START: 'DID_NOT_START',
} as const;
export type RaceResultStatus = (typeof RaceResultStatus)[keyof typeof RaceResultStatus];

/** Why one row of a race's finishing order cannot be applied (#622). */
export const RaceResultRowError = {
  DUPLICATE_PARTICIPANT: 'DUPLICATE_PARTICIPANT',
  POSITION_WITHOUT_FINISH: 'POSITION_WITHOUT_FINISH',
  FINISH_WITHOUT_POSITION: 'FINISH_WITHOUT_POSITION',
} as const;
export type RaceResultRowError = (typeof RaceResultRowError)[keyof typeof RaceResultRowError];

/** Why a race's finishing order as a whole cannot be applied (#622). */
export const RaceResultOrderError = {
  POSITIONS_INVALID: 'POSITIONS_INVALID',
  FIELD_INCOMPLETE: 'FIELD_INCOMPLETE',
} as const;
export type RaceResultOrderError = (typeof RaceResultOrderError)[keyof typeof RaceResultOrderError];

/** What applying one row of a finishing order would do to the runner's stored result (#622). */
export const RaceResultChange = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  UNCHANGED: 'UNCHANGED',
} as const;
export type RaceResultChange = (typeof RaceResultChange)[keyof typeof RaceResultChange];

/**
 * How an entry picks its lineup. Each value has a selection engine.
 *
 * TIERED — pick N from defined tier groups; non-exclusive.
 * BUDGET_PICK — build a roster within a cost budget; non-exclusive.
 * RANDOM_DRAW — nobody picks: the commissioner's draw deals each entry members of the field
 *   at random (a sweepstake, #601); exclusive, since each is dealt once.
 */
export const SelectionType = {
  TIERED: 'TIERED',
  BUDGET_PICK: 'BUDGET_PICK',
  RANDOM_DRAW: 'RANDOM_DRAW',
  /** Pick the winner of every game of each week (#716): a PREDICTION contest. */
  PICK_EM: 'PICK_EM',
  /**
   * Pick the winner of every game of a knockout before it starts, all the way to the final
   * (#721): a PREDICTION contest. A later game's pick is a team the entry picked to get there.
   */
  BRACKET: 'BRACKET',
  /**
   * Pick one team to win each week, each team once a season (#719): a PREDICTION contest. A
   * loss, a tie or a week left unsubmitted puts the entry out; the last entries standing win.
   */
  SURVIVOR: 'SURVIVOR',
  /**
   * Claim boxes of a 10x10 grid on one game (#711): a SQUARES contest. The digits 0 to 9 are
   * drawn along each side, and the box at each scoring moment's last digits wins it.
   */
  SQUARES: 'SQUARES',
} as const;
export type SelectionType = (typeof SelectionType)[keyof typeof SelectionType];

/**
 * The kind of event a contest template is offered for (#802), where a sport's events come in more
 * than one kind. Only a sport played as matches has two: a KNOCKOUT (the playoffs, a tournament
 * bracket) and a WEEK of a season's games (an NFL regular-season week). A template with none is
 * offered for every event of its sport. Mirrors `PrismaContestTemplateEventType`.
 */
export const ContestTemplateEventType = {
  KNOCKOUT: 'KNOCKOUT',
  WEEK: 'WEEK',
} as const;
export type ContestTemplateEventType = (typeof ContestTemplateEventType)[keyof typeof ContestTemplateEventType];

/**
 * How a pick'em contest is played (#716). STRAIGHT_UP: pick the winner of every game.
 * CONFIDENCE: also rank the week's picks, giving each game a value from 1 to the number of
 * games, each used once; the most confident pick carries the highest.
 */
export const PickEmMode = {
  STRAIGHT_UP: 'STRAIGHT_UP',
  CONFIDENCE: 'CONFIDENCE',
} as const;
export type PickEmMode = (typeof PickEmMode)[keyof typeof PickEmMode];

/**
 * How one game pick stands against the results (#721). CORRECT: the team picked won its game in
 * that round, or covered the spread (#720). BUSTED: the team picked is out, or did not cover, so
 * the pick can no longer come true. PUSH: against the spread, the game landed exactly on it, so
 * the pick neither won nor lost (#720). PENDING: the game is still to be decided and the team
 * picked is still in.
 */
export const PickOutcome = {
  CORRECT: 'CORRECT',
  BUSTED: 'BUSTED',
  PUSH: 'PUSH',
  PENDING: 'PENDING',
} as const;
export type PickOutcome = (typeof PickOutcome)[keyof typeof PickOutcome];

/**
 * What one game pick says happens (#792). TEAM: the team it names wins. TIE: the game ends level,
 * a draw in soccer. Only a pick'em pool on a sport that offers tie picks takes a TIE pick
 * (`SportPickEm.tiePicks`); a bracket and survivor pick always names a team.
 */
export const PredictedResult = {
  TEAM: 'TEAM',
  TIE: 'TIE',
} as const;
export type PredictedResult = (typeof PredictedResult)[keyof typeof PredictedResult];

/**
 * How a survivor entry's week went (#719). SURVIVED: its team won, or its game was cancelled.
 * ELIMINATED: its team lost or tied, or the week started with no submitted pick. PENDING: its
 * game is still to be decided.
 */
export const SurvivorWeekOutcome = {
  SURVIVED: 'SURVIVED',
  ELIMINATED: 'ELIMINATED',
  PENDING: 'PENDING',
} as const;
export type SurvivorWeekOutcome = (typeof SurvivorWeekOutcome)[keyof typeof SurvivorWeekOutcome];

// --- Selection ---

export const SelectionStatus = {
  PENDING: 'PENDING',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
} as const;
export type SelectionStatus = (typeof SelectionStatus)[keyof typeof SelectionStatus];

// --- Sport Event Lifecycle ---

/** SportEvent lifecycle status. `OFFICIAL` intentionally dropped — see plans/124 §4.1. */
export const SportEventStatus = {
  /** Being prepared by an admin and hidden from commissioners until released (#431). */
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  POSTPONED: 'POSTPONED',
} as const;
export type SportEventStatus = (typeof SportEventStatus)[keyof typeof SportEventStatus];

/**
 * Whether provider sync may touch a SportEvent — separate from providerId/externalId
 * identity. NONE: unlinked, nothing syncs. SCORES_ONLY: an admin linked it to a provider
 * event, so live scores (and an admin-triggered field load) reach it. Every event is
 * admin-owned; a provider never sets its details or status (ADR-0009).
 */
export const SportEventSyncScope = {
  NONE: 'NONE',
  SCORES_ONLY: 'SCORES_ONLY',
} as const;
export type SportEventSyncScope = (typeof SportEventSyncScope)[keyof typeof SportEventSyncScope];

/** Where one provider sync run is in its lifecycle. */
export const ProviderSyncRunStatus = {
  SUBMITTED: 'SUBMITTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProviderSyncRunStatus = (typeof ProviderSyncRunStatus)[keyof typeof ProviderSyncRunStatus];

/** Where one in-memory ingestion job is; a provider sync run records the job's outcome. */
export const IngestionJobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type IngestionJobStatus = (typeof IngestionJobStatus)[keyof typeof IngestionJobStatus];

/**
 * A participant's progress through one round (SportEventParticipantRound.status), as the
 * score source reported it. Every round row is written with one of these; there is no
 * "not started" value, because a round with no scores has no row.
 */
export const ParticipantRoundStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  DNF: 'DNF',
  DSQ: 'DSQ',
  MISSED_CUT: 'MISSED_CUT',
} as const;
export type ParticipantRoundStatus = (typeof ParticipantRoundStatus)[keyof typeof ParticipantRoundStatus];

/**
 * Why a SportEventParticipant is inactive for a golf tournament. Meaningful only
 * when `SportEventParticipant.isActive` is false; null covers "inactive, no more
 * specific reason recorded." See plans/124 §4.1.
 */
/**
 * Why a SportEventParticipant is inactive. Cross-sport: a golfer who missed the
 * cut is ELIMINATED, as is a knocked-out seed. Golf surfaces render ELIMINATED
 * as "Cut" for their audience; the value stays sport-agnostic. `null` means
 * "inactive, no more specific reason recorded" — there is no OTHER.
 */
export const ParticipantInactiveReason = {
  WITHDRAWN: 'WITHDRAWN',
  ELIMINATED: 'ELIMINATED',
} as const;
export type ParticipantInactiveReason =
  (typeof ParticipantInactiveReason)[keyof typeof ParticipantInactiveReason];

/**
 * A participant's live state within one event (SportEventParticipantStanding.status).
 * Cross-sport: ELIMINATED covers a golfer who missed the cut as well as a
 * knocked-out team, matching ParticipantInactiveReason.
 */
export const ParticipantStandingStatus = {
  ACTIVE: 'ACTIVE',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETE: 'COMPLETE',
  WITHDRAWN: 'WITHDRAWN',
  ELIMINATED: 'ELIMINATED',
} as const;
export type ParticipantStandingStatus =
  (typeof ParticipantStandingStatus)[keyof typeof ParticipantStandingStatus];

export type LegacyParticipantStatus = 'ACTIVE' | 'INACTIVE' | ParticipantInactiveReason;

/**
 * Derives the pre-`isActive`/`inactiveReason` legacy participant-status string
 * (`'ACTIVE'` / `'INACTIVE'` / a `ParticipantInactiveReason`) some response
 * shapes still expose on the wire (`ContestEntryParticipantDetailDto`,
 * the selection-room selection-participant status).
 * New endpoints should read `isActive`/`inactiveReason` directly instead of this
 * string — see plans/124 §4.1. Single source of truth so every call site derives
 * the same value the same way rather than re-implementing the ternary.
 */
export function deriveLegacyParticipantStatus(
  isActive: boolean,
  inactiveReason: ParticipantInactiveReason | null | undefined,
): LegacyParticipantStatus {
  if (isActive) {
    return 'ACTIVE';
  }
  return inactiveReason ?? 'INACTIVE';
}

// --- Contest Lifecycle ---

export const ContestStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
} as const;
export type ContestStatus = (typeof ContestStatus)[keyof typeof ContestStatus];

/**
 * Where an entry stands in one event of its contest (#481, per event since #713). An entry's
 * event is born DRAFT and its owner submits it once that event's lineup is complete. Only
 * SUBMITTED events count: the leaderboard, standings, settlement and member-visible entry
 * counts all read them alone. A pick change that leaves a submitted lineup short sends that
 * event back to DRAFT.
 */
export const ContestEntryStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
} as const;
export type ContestEntryStatus = (typeof ContestEntryStatus)[keyof typeof ContestEntryStatus];

/** How a prize definition's payout is expressed. */
export const PrizePayoutType = {
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  PERCENTAGE: 'PERCENTAGE',
} as const;
export type PrizePayoutType = (typeof PrizePayoutType)[keyof typeof PrizePayoutType];

// --- League ---

export const LeagueRole = {
  COMMISSIONER: 'COMMISSIONER',
  MEMBER: 'MEMBER',
} as const;
export type LeagueRole = (typeof LeagueRole)[keyof typeof LeagueRole];

export const LeagueMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type LeagueMembershipStatus =
  (typeof LeagueMembershipStatus)[keyof typeof LeagueMembershipStatus];

export const LeagueIconKey = {
  GOLF_FLAG: 'GOLF_FLAG',
  GOLF_BALL: 'GOLF_BALL',
  FOOTBALL: 'FOOTBALL',
  FOOTBALL_HELMET: 'FOOTBALL_HELMET',
  BASKETBALL: 'BASKETBALL',
  BASKETBALL_HOOP: 'BASKETBALL_HOOP',
  CHECKERED_FLAG: 'CHECKERED_FLAG',
  RACING_WHEEL: 'RACING_WHEEL',
  TENNIS_BALL: 'TENNIS_BALL',
  TENNIS_RACKET: 'TENNIS_RACKET',
  HORSESHOE: 'HORSESHOE',
  SOCCER_BALL: 'SOCCER_BALL',
  HOCKEY_STICK: 'HOCKEY_STICK',
  HOCKEY_PUCK: 'HOCKEY_PUCK',
  BASEBALL: 'BASEBALL',
  BASEBALL_BAT: 'BASEBALL_BAT',
  FIGHT_GLOVE: 'FIGHT_GLOVE',
  TROPHY: 'TROPHY',
  WHISTLE: 'WHISTLE',
  STOPWATCH: 'STOPWATCH',
} as const;
export type LeagueIconKey = (typeof LeagueIconKey)[keyof typeof LeagueIconKey];

export const AuthProvider = {
  EMAIL: 'email',
  GOOGLE: 'google',
  APPLE: 'apple',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const TimeFormat = {
  TWELVE_HOUR: '12H',
  TWENTY_FOUR_HOUR: '24H',
} as const;
export type TimeFormat = (typeof TimeFormat)[keyof typeof TimeFormat];

export const DateFormat = {
  MDY: 'MDY',
  DMY: 'DMY',
  YMD: 'YMD',
} as const;
export type DateFormat = (typeof DateFormat)[keyof typeof DateFormat];

/** What auto-assignment orders a field by when it fills an event's tiers. Cross-sport (#236; was GolfTierSource). */
export const TierSource = {
  ODDS: 'ODDS',
  RANKING: 'RANKING',
} as const;
export type TierSource = (typeof TierSource)[keyof typeof TierSource];

/** How a SportEventParticipantValuation's tier/price was set. See plans/124 §4.5. */
export const ValuationSource = {
  AUTO_ODDS: 'AUTO_ODDS',
  AUTO_RANKING: 'AUTO_RANKING',
  MANUAL: 'MANUAL',
} as const;
export type ValuationSource = (typeof ValuationSource)[keyof typeof ValuationSource];

export const GolfCategoryKey = {
  SENIOR: 'SENIOR',
  ROOKIE: 'ROOKIE',
  PREVIOUS_WINNER: 'PREVIOUS_WINNER',
  US_PLAYER: 'US_PLAYER',
  INTERNATIONAL_PLAYER: 'INTERNATIONAL_PLAYER',
} as const;
export type GolfCategoryKey =
  (typeof GolfCategoryKey)[keyof typeof GolfCategoryKey];

export const GolfCutRuleType = {
  FIXED_SCORE: 'FIXED_SCORE',
} as const;
export type GolfCutRuleType =
  (typeof GolfCutRuleType)[keyof typeof GolfCutRuleType];

export const TeamIconKey = {
  CAPTAIN_SMILE_SUNSET: 'CAPTAIN_SMILE_SUNSET',
  CAPTAIN_SMILE_FIELD: 'CAPTAIN_SMILE_FIELD',
  CAPTAIN_SMILE_OCEAN: 'CAPTAIN_SMILE_OCEAN',
  CAPTAIN_SMILE_MIDNIGHT: 'CAPTAIN_SMILE_MIDNIGHT',
  CAPTAIN_SMILE_CANDY: 'CAPTAIN_SMILE_CANDY',
  CAPTAIN_WINK_SUNSET: 'CAPTAIN_WINK_SUNSET',
  CAPTAIN_WINK_FIELD: 'CAPTAIN_WINK_FIELD',
  CAPTAIN_WINK_OCEAN: 'CAPTAIN_WINK_OCEAN',
  CAPTAIN_WINK_MIDNIGHT: 'CAPTAIN_WINK_MIDNIGHT',
  CAPTAIN_WINK_CANDY: 'CAPTAIN_WINK_CANDY',
  CHAMPION_BEARD_SUNSET: 'CHAMPION_BEARD_SUNSET',
  CHAMPION_BEARD_FIELD: 'CHAMPION_BEARD_FIELD',
  CHAMPION_BEARD_OCEAN: 'CHAMPION_BEARD_OCEAN',
  CHAMPION_BEARD_MIDNIGHT: 'CHAMPION_BEARD_MIDNIGHT',
  CHAMPION_BEARD_CANDY: 'CHAMPION_BEARD_CANDY',
  MAVERICK_MASK_SUNSET: 'MAVERICK_MASK_SUNSET',
  MAVERICK_MASK_FIELD: 'MAVERICK_MASK_FIELD',
  MAVERICK_MASK_OCEAN: 'MAVERICK_MASK_OCEAN',
  MAVERICK_MASK_MIDNIGHT: 'MAVERICK_MASK_MIDNIGHT',
  MAVERICK_MASK_CANDY: 'MAVERICK_MASK_CANDY',
  STARFACE_SUNSET: 'STARFACE_SUNSET',
  STARFACE_FIELD: 'STARFACE_FIELD',
  STARFACE_OCEAN: 'STARFACE_OCEAN',
  STARFACE_MIDNIGHT: 'STARFACE_MIDNIGHT',
  STARFACE_CANDY: 'STARFACE_CANDY',
  HELMET_STRIPE_SUNSET: 'HELMET_STRIPE_SUNSET',
  HELMET_STRIPE_FIELD: 'HELMET_STRIPE_FIELD',
  HELMET_STRIPE_OCEAN: 'HELMET_STRIPE_OCEAN',
  HELMET_STRIPE_MIDNIGHT: 'HELMET_STRIPE_MIDNIGHT',
  HELMET_STRIPE_CANDY: 'HELMET_STRIPE_CANDY',
  HELMET_BOLT_SUNSET: 'HELMET_BOLT_SUNSET',
  HELMET_BOLT_FIELD: 'HELMET_BOLT_FIELD',
  HELMET_BOLT_OCEAN: 'HELMET_BOLT_OCEAN',
  HELMET_BOLT_MIDNIGHT: 'HELMET_BOLT_MIDNIGHT',
  HELMET_BOLT_CANDY: 'HELMET_BOLT_CANDY',
  HELMET_HORN_SUNSET: 'HELMET_HORN_SUNSET',
  HELMET_HORN_FIELD: 'HELMET_HORN_FIELD',
  HELMET_HORN_OCEAN: 'HELMET_HORN_OCEAN',
  HELMET_HORN_MIDNIGHT: 'HELMET_HORN_MIDNIGHT',
  HELMET_HORN_CANDY: 'HELMET_HORN_CANDY',
  HELMET_WING_SUNSET: 'HELMET_WING_SUNSET',
  HELMET_WING_FIELD: 'HELMET_WING_FIELD',
  HELMET_WING_OCEAN: 'HELMET_WING_OCEAN',
  HELMET_WING_MIDNIGHT: 'HELMET_WING_MIDNIGHT',
  HELMET_WING_CANDY: 'HELMET_WING_CANDY',
  HELMET_GRID_SUNSET: 'HELMET_GRID_SUNSET',
  HELMET_GRID_FIELD: 'HELMET_GRID_FIELD',
  HELMET_GRID_OCEAN: 'HELMET_GRID_OCEAN',
  HELMET_GRID_MIDNIGHT: 'HELMET_GRID_MIDNIGHT',
  HELMET_GRID_CANDY: 'HELMET_GRID_CANDY',
  GOLF_BAG_SUNSET: 'GOLF_BAG_SUNSET',
  GOLF_BAG_FIELD: 'GOLF_BAG_FIELD',
  GOLF_BAG_OCEAN: 'GOLF_BAG_OCEAN',
  GOLF_BAG_MIDNIGHT: 'GOLF_BAG_MIDNIGHT',
  GOLF_BAG_CANDY: 'GOLF_BAG_CANDY',
  WHISTLE_BADGE_SUNSET: 'WHISTLE_BADGE_SUNSET',
  WHISTLE_BADGE_FIELD: 'WHISTLE_BADGE_FIELD',
  WHISTLE_BADGE_OCEAN: 'WHISTLE_BADGE_OCEAN',
  WHISTLE_BADGE_MIDNIGHT: 'WHISTLE_BADGE_MIDNIGHT',
  WHISTLE_BADGE_CANDY: 'WHISTLE_BADGE_CANDY',
  STOPWATCH_BADGE_SUNSET: 'STOPWATCH_BADGE_SUNSET',
  STOPWATCH_BADGE_FIELD: 'STOPWATCH_BADGE_FIELD',
  STOPWATCH_BADGE_OCEAN: 'STOPWATCH_BADGE_OCEAN',
  STOPWATCH_BADGE_MIDNIGHT: 'STOPWATCH_BADGE_MIDNIGHT',
  STOPWATCH_BADGE_CANDY: 'STOPWATCH_BADGE_CANDY',
  MEGAPHONE_SUNSET: 'MEGAPHONE_SUNSET',
  MEGAPHONE_FIELD: 'MEGAPHONE_FIELD',
  MEGAPHONE_OCEAN: 'MEGAPHONE_OCEAN',
  MEGAPHONE_MIDNIGHT: 'MEGAPHONE_MIDNIGHT',
  MEGAPHONE_CANDY: 'MEGAPHONE_CANDY',
  FOAM_FINGER_SUNSET: 'FOAM_FINGER_SUNSET',
  FOAM_FINGER_FIELD: 'FOAM_FINGER_FIELD',
  FOAM_FINGER_OCEAN: 'FOAM_FINGER_OCEAN',
  FOAM_FINGER_MIDNIGHT: 'FOAM_FINGER_MIDNIGHT',
  FOAM_FINGER_CANDY: 'FOAM_FINGER_CANDY',
  BULL_HEAD_SUNSET: 'BULL_HEAD_SUNSET',
  BULL_HEAD_FIELD: 'BULL_HEAD_FIELD',
  BULL_HEAD_OCEAN: 'BULL_HEAD_OCEAN',
  BULL_HEAD_MIDNIGHT: 'BULL_HEAD_MIDNIGHT',
  BULL_HEAD_CANDY: 'BULL_HEAD_CANDY',
  LUCKY_DUCK_SUNSET: 'LUCKY_DUCK_SUNSET',
  LUCKY_DUCK_FIELD: 'LUCKY_DUCK_FIELD',
  LUCKY_DUCK_OCEAN: 'LUCKY_DUCK_OCEAN',
  LUCKY_DUCK_MIDNIGHT: 'LUCKY_DUCK_MIDNIGHT',
  LUCKY_DUCK_CANDY: 'LUCKY_DUCK_CANDY',
  TURBO_TURTLE_SUNSET: 'TURBO_TURTLE_SUNSET',
  TURBO_TURTLE_FIELD: 'TURBO_TURTLE_FIELD',
  TURBO_TURTLE_OCEAN: 'TURBO_TURTLE_OCEAN',
  TURBO_TURTLE_MIDNIGHT: 'TURBO_TURTLE_MIDNIGHT',
  TURBO_TURTLE_CANDY: 'TURBO_TURTLE_CANDY',
  FIRE_PIZZA_SUNSET: 'FIRE_PIZZA_SUNSET',
  FIRE_PIZZA_FIELD: 'FIRE_PIZZA_FIELD',
  FIRE_PIZZA_OCEAN: 'FIRE_PIZZA_OCEAN',
  FIRE_PIZZA_MIDNIGHT: 'FIRE_PIZZA_MIDNIGHT',
  FIRE_PIZZA_CANDY: 'FIRE_PIZZA_CANDY',
  BANANA_BAT_SUNSET: 'BANANA_BAT_SUNSET',
  BANANA_BAT_FIELD: 'BANANA_BAT_FIELD',
  BANANA_BAT_OCEAN: 'BANANA_BAT_OCEAN',
  BANANA_BAT_MIDNIGHT: 'BANANA_BAT_MIDNIGHT',
  BANANA_BAT_CANDY: 'BANANA_BAT_CANDY',
} as const;
export type TeamIconKey = (typeof TeamIconKey)[keyof typeof TeamIconKey];

export const SquadMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type SquadMembershipStatus =
  (typeof SquadMembershipStatus)[keyof typeof SquadMembershipStatus];

export const SquadOwnerInvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type SquadOwnerInvitationStatus =
  (typeof SquadOwnerInvitationStatus)[keyof typeof SquadOwnerInvitationStatus];

// --- League Invitation ---

export const InviteType = {
  EMAIL: 'EMAIL',
  LINK: 'LINK',
} as const;
export type InviteType = (typeof InviteType)[keyof typeof InviteType];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

// --- Week Day ---

export const WeekDay = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;
export type WeekDay = (typeof WeekDay)[keyof typeof WeekDay];

// --- Tier Assignment ---

export const TierAssignmentMode = {
  AUTO_RANKING: 'AUTO_RANKING',
  AUTO_PRICE: 'AUTO_PRICE',
  MANUAL: 'MANUAL',
} as const;
export type TierAssignmentMode = (typeof TierAssignmentMode)[keyof typeof TierAssignmentMode];

// --- Admin ---

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  SUPPORT: 'SUPPORT',
  DATA_OPS: 'DATA_OPS',
  VIEWER: 'VIEWER',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

// --- Announcements ---

export const AnnouncementType = {
  BANNER: 'BANNER',
  NOTIFICATION: 'NOTIFICATION',
  BOTH: 'BOTH',
} as const;
export type AnnouncementType = (typeof AnnouncementType)[keyof typeof AnnouncementType];

export const AnnouncementTarget = {
  ALL_USERS: 'ALL_USERS',
  ALL_TENANTS: 'ALL_TENANTS',
  SPECIFIC_TENANTS: 'SPECIFIC_TENANTS',
} as const;
export type AnnouncementTarget = (typeof AnnouncementTarget)[keyof typeof AnnouncementTarget];

export const Severity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  ERROR: 'ERROR',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

// --- System email (#844) ---

/**
 * The email categories (#844, #845). Each system email sits in one; the category decides whether
 * a member can turn the email off and which unsubscribe link it carries. The list is the
 * notification catalog's (`plans/email-notifications.md` §2).
 */
export const EmailCategory = {
  /** Account and security. Can't be turned off. */
  ACCOUNT: 'ACCOUNT',
  /** Invitations and membership. Can't be turned off. */
  MEMBERSHIP: 'MEMBERSHIP',
  COMMISSIONER_UPDATES: 'COMMISSIONER_UPDATES',
  CONTEST_UPDATES: 'CONTEST_UPDATES',
  LIVE_STANDINGS: 'LIVE_STANDINGS',
  RESULTS: 'RESULTS',
  RECEIPTS: 'RECEIPTS',
  /** Root admin operations, such as an event still in draft. Can't be turned off. */
  ROOT_ADMIN: 'ROOT_ADMIN',
} as const;
export type EmailCategory = (typeof EmailCategory)[keyof typeof EmailCategory];

/** The categories a member can turn off, one switch each on their account (#844 slice 5, Q7.1). */
export const OptionalEmailCategory = {
  COMMISSIONER_UPDATES: EmailCategory.COMMISSIONER_UPDATES,
  CONTEST_UPDATES: EmailCategory.CONTEST_UPDATES,
  LIVE_STANDINGS: EmailCategory.LIVE_STANDINGS,
  RESULTS: EmailCategory.RESULTS,
  RECEIPTS: EmailCategory.RECEIPTS,
} as const;
export type OptionalEmailCategory = (typeof OptionalEmailCategory)[keyof typeof OptionalEmailCategory];

export function isOptionalEmailCategory(category: EmailCategory): category is OptionalEmailCategory {
  return Object.values<EmailCategory>(OptionalEmailCategory).includes(category);
}

/**
 * Which service level an email or a view belongs to (#845, #841; Derek 2026-10-22), so that
 * monetization can later offer each only to leagues whose plan includes it. Not tied to plan
 * names: the monetization work maps each class to its plans. Nothing is gated on it yet.
 */
export const ServiceClass = {
  /** Account, security and membership. Every league gets it, on every plan, always. */
  ESSENTIAL: 'ESSENTIAL',
  /** The basics, on the free plan too: a contest opening, receipts, final results. */
  A: 'A',
  /** Paid plans from Pro (plans/season-cups.md §7, plans/email-notifications.md *Class*). */
  B: 'B',
} as const;
export type ServiceClass = (typeof ServiceClass)[keyof typeof ServiceClass];

/** The system emails core-api can send, one per template. */
export const EmailTemplateKey = {
  LEAGUE_MEMBER_INVITE: 'LEAGUE_MEMBER_INVITE',
  LEAGUE_JOIN_SUCCESS: 'LEAGUE_JOIN_SUCCESS',
  SQUAD_OWNER_INVITE: 'SQUAD_OWNER_INVITE',
  SQUAD_OWNER_ADDED: 'SQUAD_OWNER_ADDED',
  CONTEST_ENTRY_COMPLETED: 'CONTEST_ENTRY_COMPLETED',
  CONTEST_STARTED_SUMMARY: 'CONTEST_STARTED_SUMMARY',
  CONTEST_ENTRY_REMINDER: 'CONTEST_ENTRY_REMINDER',
  CONTEST_OPENED: 'CONTEST_OPENED',
  CONTEST_STANDINGS: 'CONTEST_STANDINGS',
  CONTEST_RESULTS: 'CONTEST_RESULTS',
  CONTEST_EVENT_CHANGED: 'CONTEST_EVENT_CHANGED',
  EVENT_COMING_UP: 'EVENT_COMING_UP',
  EVENT_READY_FOR_CONTESTS: 'EVENT_READY_FOR_CONTESTS',
  CONTEST_NOT_OPEN: 'CONTEST_NOT_OPEN',
  EVENT_STILL_DRAFT: 'EVENT_STILL_DRAFT',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
} as const;
export type EmailTemplateKey = (typeof EmailTemplateKey)[keyof typeof EmailTemplateKey];

/**
 * The emails EMAIL_CONFIG has a switch for. Account emails (the password reset and the
 * password-changed notice) have none: switching one off would silently break password recovery
 * or hide a takeover. They still obey the overall switch.
 */
export type SwitchableEmailTemplateKey = Exclude<
  EmailTemplateKey,
  typeof EmailTemplateKey.PASSWORD_RESET | typeof EmailTemplateKey.PASSWORD_CHANGED
>;

/** Where one email in the outbox stands. */
export const EmailMessageStatus = {
  /** Waiting for the sender, first time or after a failed try. */
  QUEUED: 'QUEUED',
  /** Claimed by a sender, which is handing it to the transport. */
  SENDING: 'SENDING',
  /** The transport accepted it. */
  SENT: 'SENT',
  /** SES reports it reached the recipient's mail server. */
  DELIVERED: 'DELIVERED',
  /** SES reports the recipient's mail server refused it for good (a permanent bounce). */
  BOUNCED: 'BOUNCED',
  /** SES reports the recipient marked it as spam. */
  COMPLAINED: 'COMPLAINED',
  /** Every try failed, or SES rejected it; it will not be sent. */
  FAILED: 'FAILED',
  /** Never queued, for the skip reason. */
  SKIPPED: 'SKIPPED',
} as const;
export type EmailMessageStatus = (typeof EmailMessageStatus)[keyof typeof EmailMessageStatus];

/** Why an email was skipped rather than queued. */
export const EmailSkipReason = {
  /** EMAIL_CONFIG has system email switched off. */
  EMAIL_DISABLED: 'EMAIL_DISABLED',
  /** EMAIL_CONFIG has this template switched off. */
  TEMPLATE_DISABLED: 'TEMPLATE_DISABLED',
  /** The recipient may not be emailed here: a reserved domain on a real transport, or not on the allow list. */
  NOT_ALLOWED_IN_ENVIRONMENT: 'NOT_ALLOWED_IN_ENVIRONMENT',
  /** The address bounced for good or complained before; it is on the suppression list. */
  SUPPRESSED: 'SUPPRESSED',
  /** The recipient turned this email's category off on their account, or unsubscribed from it. */
  OPTED_OUT: 'OPTED_OUT',
} as const;
export type EmailSkipReason = (typeof EmailSkipReason)[keyof typeof EmailSkipReason];

/** Why an address is on the email suppression list. */
export const EmailSuppressionReason = {
  /** A permanent bounce: the mailbox does not exist or will never accept mail. */
  BOUNCE: 'BOUNCE',
  /** The recipient marked an email as spam. */
  COMPLAINT: 'COMPLAINT',
} as const;
export type EmailSuppressionReason = (typeof EmailSuppressionReason)[keyof typeof EmailSuppressionReason];

// --- Cups (#841) ---

/**
 * How much a contest counts toward its cup and the league championship (#841), set on the
 * contest and fixed once it is COMPLETED: x1, x1.5, x2, or not at all. Every contest starts
 * NORMAL, so a commissioner never has to touch it.
 */
export const CupWeight = {
  NORMAL: 'NORMAL',
  BONUS: 'BONUS',
  DOUBLE: 'DOUBLE',
  NOT_COUNTED: 'NOT_COUNTED',
} as const;
export type CupWeight = (typeof CupWeight)[keyof typeof CupWeight];

/**
 * The league's points table for cups and the championship (#841): what each finishing place in a
 * contest earns. STANDARD 100, 80, 65 ... down to 5 for every place after 20th; TOP_TEN 25, 18,
 * 15 ... 1 and nothing after 10th; FIELD_BEATEN one point per entry finished behind, plus one;
 * CUSTOM the commissioner's own list, places past it scoring nothing.
 */
export const CupPointsScale = {
  STANDARD: 'STANDARD',
  TOP_TEN: 'TOP_TEN',
  FIELD_BEATEN: 'FIELD_BEATEN',
  CUSTOM: 'CUSTOM',
} as const;
export type CupPointsScale = (typeof CupPointsScale)[keyof typeof CupPointsScale];

/**
 * Whether one contest of a cup's season and sports league counts toward it (#841). COUNTED: it is
 * COMPLETED with places, which earn points. NOT_COUNTED: the commissioner set its weight to not
 * counted. NO_RESULT: it is COMPLETED with nobody placed (every event cancelled). NOT_FINAL: it is
 * open or live, and counts once it is COMPLETED. AFTER_CROWNING: the cup was crowned before it went
 * final, so it changes nothing. Drafts never opened are not listed at all.
 */
export const CupContestCount = {
  COUNTED: 'COUNTED',
  NOT_COUNTED: 'NOT_COUNTED',
  NO_RESULT: 'NO_RESULT',
  NOT_FINAL: 'NOT_FINAL',
  AFTER_CROWNING: 'AFTER_CROWNING',
} as const;
export type CupContestCount = (typeof CupContestCount)[keyof typeof CupContestCount];

/**
 * Whether a contest that went final counts toward the league championship of its year (#837).
 * COUNTED: squads placed and earned points. NOT_COUNTED: its weight is not counted; its places
 * stand but earn nothing. NO_RESULT: nobody placed (every event cancelled).
 */
export const ContestResultCount = {
  COUNTED: 'COUNTED',
  NOT_COUNTED: 'NOT_COUNTED',
  NO_RESULT: 'NO_RESULT',
} as const;
export type ContestResultCount = (typeof ContestResultCount)[keyof typeof ContestResultCount];

/**
 * A cup's state (#841): OPEN while its standings are worked out on read; CROWNED once the
 * commissioner crowns it, its standings frozen and its trophies handed out.
 */
export const CupStatus = {
  OPEN: 'OPEN',
  CROWNED: 'CROWNED',
} as const;
export type CupStatus = (typeof CupStatus)[keyof typeof CupStatus];

/** The trophy a squad takes from a crowned cup (#841): 1st, 2nd or 3rd. Squads sharing a place share its trophy. */
export const CupTrophy = {
  CHAMPION: 'CHAMPION',
  RUNNER_UP: 'RUNNER_UP',
  THIRD: 'THIRD',
} as const;
export type CupTrophy = (typeof CupTrophy)[keyof typeof CupTrophy];

/**
 * The All years page's tiles (#837): the squads with the most league championships won (years
 * over only) and the most cups won (crowned cups' champions). Ties name every squad.
 */
export const SummaryTile = {
  MOST_CHAMPIONSHIPS: 'MOST_CHAMPIONSHIPS',
  MOST_CUPS: 'MOST_CUPS',
} as const;
export type SummaryTile = (typeof SummaryTile)[keyof typeof SummaryTile];

/**
 * The league championship's medal tiles (#863): which count each one leads on. A podium is a 1st,
 * 2nd or 3rd; PLAYED counts the counted contests a squad placed in.
 */
export const ChampionshipTile = {
  MOST_FIRSTS: 'MOST_FIRSTS',
  MOST_SECONDS: 'MOST_SECONDS',
  MOST_THIRDS: 'MOST_THIRDS',
  MOST_PODIUMS: 'MOST_PODIUMS',
  MOST_TOP_TENS: 'MOST_TOP_TENS',
  MOST_PLAYED: 'MOST_PLAYED',
} as const;
export type ChampionshipTile = (typeof ChampionshipTile)[keyof typeof ChampionshipTile];
