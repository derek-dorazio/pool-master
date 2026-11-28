/**
 * Enumerations used across the PoolMaster domain.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active backend
 * refactor plans. Some values remain as deferred catalog entries even when
 * they are no longer part of the first-pass runtime surface.
 */

import { alphabeticalOrder, explicitOrder, explicitOrderValues } from './enum-order';

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
  FOOTBALL: 'FOOTBALL',
  HOCKEY: 'HOCKEY',
  BASEBALL: 'BASEBALL',
  SOCCER: 'SOCCER',
  TENNIS: 'TENNIS',
} as const;
export type Sport = (typeof Sport)[keyof typeof Sport];
/**
 * No order here: each sport's row carries its display order (`Sport.displayOrder`, #2042), and
 * every list of sports sorts by it as the API returns it.
 */

export const ParticipantType = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const;
export type ParticipantType = (typeof ParticipantType)[keyof typeof ParticipantType];
/** No natural order: A to Z by its display strings. */
export const ParticipantTypeOrder = alphabeticalOrder('ParticipantType');

// --- Participant Status ---

export const ParticipantStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  RETIRED: 'RETIRED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type ParticipantStatus = (typeof ParticipantStatus)[keyof typeof ParticipantStatus];
/** Active first, then the ways a participant stops playing. */
export const ParticipantStatusOrder = explicitOrder<ParticipantStatus>({
  [ParticipantStatus.ACTIVE]: 0,
  [ParticipantStatus.INACTIVE]: 1,
  [ParticipantStatus.SUSPENDED]: 2,
  [ParticipantStatus.RETIRED]: 3,
});

/** A sports data provider's health, from its sync runs of the last hour (#1873, #1999). */
export const ProviderHealthStatus = {
  /** None of its runs failed: Up. */
  HEALTHY: 'HEALTHY',
  /** Some of its runs failed: Partly failing. */
  DEGRADED: 'DEGRADED',
  /** All of its runs failed: Down. */
  DOWN: 'DOWN',
} as const;
export type ProviderHealthStatus = (typeof ProviderHealthStatus)[keyof typeof ProviderHealthStatus];
/** Up first, then Partly failing, then Down. */
export const ProviderHealthStatusOrder = explicitOrder<ProviderHealthStatus>({
  [ProviderHealthStatus.HEALTHY]: 0,
  [ProviderHealthStatus.DEGRADED]: 1,
  [ProviderHealthStatus.DOWN]: 2,
});

/**
 * Which data provider a Provider row is (#1997): the code picks the adapter in code, and nothing
 * else about a provider is in code.
 */
export const ProviderCode = {
  BALLDONTLIE: 'BALLDONTLIE',
} as const;
export type ProviderCode = (typeof ProviderCode)[keyof typeof ProviderCode];
/** Alphabetical: no provider ranks before another by its code. */
export const ProviderCodeOrder = explicitOrder<ProviderCode>({
  [ProviderCode.BALLDONTLIE]: 0,
});

/**
 * Which of its provider's webhook events a provider league sends for its games (#1997); the
 * adapter maps each set to the provider's own event names.
 */
export const ProviderWebhookEventSet = {
  /** A game's start, each period's end and its end. */
  GAME_PERIODS: 'GAME_PERIODS',
  /** A game's start, its half-time and its end. */
  GAME_HALVES: 'GAME_HALVES',
  /** A golf tournament's start, each round's start, each player's finished round and its end. */
  GOLF_ROUNDS: 'GOLF_ROUNDS',
  /** None: the provider publishes no notifications for the league (BALLDONTLIE's F1, #2045), which is synced on the schedule only. */
  NONE: 'NONE',
} as const;
export type ProviderWebhookEventSet = (typeof ProviderWebhookEventSet)[keyof typeof ProviderWebhookEventSet];
/** Games by periods, then by halves, then golf's rounds, then none. */
export const ProviderWebhookEventSetOrder = explicitOrder<ProviderWebhookEventSet>({
  [ProviderWebhookEventSet.GAME_PERIODS]: 0,
  [ProviderWebhookEventSet.GAME_HALVES]: 1,
  [ProviderWebhookEventSet.GOLF_ROUNDS]: 2,
  [ProviderWebhookEventSet.NONE]: 3,
});

/**
 * The phases a sport league's Season can have (#2002, plans/league-model-redesign.md §1). The
 * order below is the phases' only order.
 */
export const LeaguePhase = {
  PRESEASON: 'PRESEASON',
  REGULAR: 'REGULAR',
  /** The conference tournaments and title games before the league's own postseason (#2153). */
  POSTSEASON_CONFERENCE: 'POSTSEASON_CONFERENCE',
  POSTSEASON: 'POSTSEASON',
} as const;
export type LeaguePhase = (typeof LeaguePhase)[keyof typeof LeaguePhase];
/** The order a Season plays its phases in. */
export const LeaguePhaseOrder = explicitOrder<LeaguePhase>({
  [LeaguePhase.PRESEASON]: 0,
  [LeaguePhase.REGULAR]: 1,
  [LeaguePhase.POSTSEASON_CONFERENCE]: 2,
  [LeaguePhase.POSTSEASON]: 3,
});

/**
 * How far a Season's competition or phase has got (#2153): its games not begun, under way, or all
 * final. Slice 14 (#2013) moves it from the Season slots' statuses.
 */
export const SeasonCompetitionStatus = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type SeasonCompetitionStatus = (typeof SeasonCompetitionStatus)[keyof typeof SeasonCompetitionStatus];
/** The order a competition moves through. */
export const SeasonCompetitionStatusOrder = explicitOrder<SeasonCompetitionStatus>({
  [SeasonCompetitionStatus.SCHEDULED]: 0,
  [SeasonCompetitionStatus.IN_PROGRESS]: 1,
  [SeasonCompetitionStatus.COMPLETED]: 2,
});

/**
 * What a slot definition is within its phase (#2002): a numbered week, a knockout round counted
 * back from the final, or one recurring tournament (golf, tennis, racing).
 */
export const SlotKind = {
  WEEK: 'WEEK',
  PLAY_IN: 'PLAY_IN',
  ROUND_OF_64: 'ROUND_OF_64',
  ROUND_OF_32: 'ROUND_OF_32',
  ROUND_OF_16: 'ROUND_OF_16',
  QUARTERFINAL: 'QUARTERFINAL',
  SEMIFINAL: 'SEMIFINAL',
  THIRD_PLACE: 'THIRD_PLACE',
  FINAL: 'FINAL',
  TOURNAMENT: 'TOURNAMENT',
} as const;
export type SlotKind = (typeof SlotKind)[keyof typeof SlotKind];
/**
 * The order slots are played in within a phase: weeks (by week number), then the knockout rounds
 * to the final. Tournaments come last here; a Season orders them by date.
 */
export const SlotKindOrder = explicitOrder<SlotKind>({
  [SlotKind.WEEK]: 0,
  [SlotKind.PLAY_IN]: 1,
  [SlotKind.ROUND_OF_64]: 2,
  [SlotKind.ROUND_OF_32]: 3,
  [SlotKind.ROUND_OF_16]: 4,
  [SlotKind.QUARTERFINAL]: 5,
  [SlotKind.SEMIFINAL]: 6,
  [SlotKind.THIRD_PLACE]: 7,
  [SlotKind.FINAL]: 8,
  [SlotKind.TOURNAMENT]: 9,
});

/** How one meeting of two sides in a slot is decided (#2002). */
export const SeriesFormat = {
  /** One game. */
  SINGLE_GAME: 'SINGLE_GAME',
  /** The first to win most of an odd number of games. */
  BEST_OF: 'BEST_OF',
  /** Goals over two or more legs. */
  AGGREGATE: 'AGGREGATE',
} as const;
export type SeriesFormat = (typeof SeriesFormat)[keyof typeof SeriesFormat];
/** One game, then a series, then legs. */
export const SeriesFormatOrder = explicitOrder<SeriesFormat>({
  [SeriesFormat.SINGLE_GAME]: 0,
  [SeriesFormat.BEST_OF]: 1,
  [SeriesFormat.AGGREGATE]: 2,
});

/** How a slot's winners meet in the next slot (#2002). */
export const SlotPairing = {
  /** By the bracket's fixed links. */
  FIXED: 'FIXED',
  /** Reseeded by seed after the slot (the NFL's). */
  RESEEDED: 'RESEEDED',
} as const;
export type SlotPairing = (typeof SlotPairing)[keyof typeof SlotPairing];
export const SlotPairingOrder = explicitOrder<SlotPairing>({
  [SlotPairing.FIXED]: 0,
  [SlotPairing.RESEEDED]: 1,
});

/** Where a Season's slot is in play (#2003, plan §2), in the order it moves through them. */
export const SeasonSlotStatus = {
  /** Not started. */
  SCHEDULED: 'SCHEDULED',
  /** A game of it has started. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Every game of it is decided; final, and never reopened on its own. */
  COMPLETED: 'COMPLETED',
  /** Not played: set from the feed or by a root admin (slice 14). */
  CANCELLED: 'CANCELLED',
} as const;
export type SeasonSlotStatus = (typeof SeasonSlotStatus)[keyof typeof SeasonSlotStatus];
export const SeasonSlotStatusOrder = explicitOrder<SeasonSlotStatus>({
  [SeasonSlotStatus.SCHEDULED]: 0,
  [SeasonSlotStatus.IN_PROGRESS]: 1,
  [SeasonSlotStatus.COMPLETED]: 2,
  [SeasonSlotStatus.CANCELLED]: 3,
});

/**
 * Whether a Season slot's date window (#2012) is the schedule's published dates or a best guess,
 * loaded while the shape is known and the games are not. In the order a window moves through them.
 */
export const SlotWindowStatus = {
  /** A best guess: the sync places games by it, and a finding asks for the published dates. */
  TENTATIVE: 'TENTATIVE',
  /** The schedule's published dates. */
  CONFIRMED: 'CONFIRMED',
} as const;
export type SlotWindowStatus = (typeof SlotWindowStatus)[keyof typeof SlotWindowStatus];
export const SlotWindowStatusOrder = explicitOrder<SlotWindowStatus>({
  [SlotWindowStatus.TENTATIVE]: 0,
  [SlotWindowStatus.CONFIRMED]: 1,
});

/** How a provider's games are matched to a slot definition (#2002, plan §1 and §6), in matching order. */
export const SlotProviderMatchType = {
  /** The code the provider's adapter reduces a game to (`REG:5`, `POST:3`). */
  PROVIDER_CODE: 'PROVIDER_CODE',
  /** A normalized tournament name, for open phases. */
  NAME_PATTERN: 'NAME_PATTERN',
  /** A date window, for a feed with no round marker. */
  DATE_WINDOW: 'DATE_WINDOW',
  /** The calendar week a game is played in, by the one global week rule. */
  CALENDAR_WEEK: 'CALENDAR_WEEK',
  /**
   * Every game in the slot's window that no other slot places, whoever plays it (#2154): a
   * phase's bowls beside its playoff, or a weekend of title games. Matched last.
   */
  REST_OF_PHASE: 'REST_OF_PHASE',
} as const;
export type SlotProviderMatchType = (typeof SlotProviderMatchType)[keyof typeof SlotProviderMatchType];
/** The order the sync tries them in (plan §6). */
export const SlotProviderMatchTypeOrder = explicitOrder<SlotProviderMatchType>({
  [SlotProviderMatchType.PROVIDER_CODE]: 0,
  [SlotProviderMatchType.NAME_PATTERN]: 1,
  [SlotProviderMatchType.DATE_WINDOW]: 2,
  [SlotProviderMatchType.CALENDAR_WEEK]: 3,
  [SlotProviderMatchType.REST_OF_PHASE]: 4,
});

/**
 * How a slot's games are contested (#2043, plan §1): two sides meeting, or a whole field ranked
 * against each other. Copied to each Round when events carry slots.
 */
export const MatchFormat = {
  /** Two sides meet: a team game, a tennis match. */
  HEAD_TO_HEAD: 'HEAD_TO_HEAD',
  /** A whole field is ranked: a golf round, a race. */
  FIELD: 'FIELD',
} as const;
export type MatchFormat = (typeof MatchFormat)[keyof typeof MatchFormat];
export const MatchFormatOrder = explicitOrder<MatchFormat>({
  [MatchFormat.HEAD_TO_HEAD]: 0,
  [MatchFormat.FIELD]: 1,
});

/** What a game of a slot is played in, beside how many (#2043): its words come from the display strings. */
export const PeriodUnit = {
  QUARTER: 'QUARTER',
  HALF: 'HALF',
  PERIOD: 'PERIOD',
  INNING: 'INNING',
  HOLE: 'HOLE',
} as const;
export type PeriodUnit = (typeof PeriodUnit)[keyof typeof PeriodUnit];
/** No natural order: A to Z by its display strings. */
export const PeriodUnitOrder = alphabeticalOrder('PeriodUnit');

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
/** The order the values are declared in. */
export const InjuryStatusCodeOrder = explicitOrder<InjuryStatusCode>({
  [InjuryStatusCode.HEALTHY]: 0,
  [InjuryStatusCode.QUESTIONABLE]: 1,
  [InjuryStatusCode.DOUBTFUL]: 2,
  [InjuryStatusCode.OUT]: 3,
  [InjuryStatusCode.WITHDRAWN]: 4,
  [InjuryStatusCode.SUSPENDED]: 5,
  [InjuryStatusCode.SCRATCHED]: 6,
});

export const FormTrend = {
  RISING: 'RISING',
  STABLE: 'STABLE',
  FALLING: 'FALLING',
} as const;
export type FormTrend = (typeof FormTrend)[keyof typeof FormTrend];
/** The order the values are declared in. */
export const FormTrendOrder = explicitOrder<FormTrend>({
  [FormTrend.RISING]: 0,
  [FormTrend.STABLE]: 1,
  [FormTrend.FALLING]: 2,
});

// --- Contest Pool ---

export const PoolType = {
  EVENT_FIELD: 'EVENT_FIELD',
  CUSTOM: 'CUSTOM',
  RANKING_CUTOFF: 'RANKING_CUTOFF',
  FULL_SPORT: 'FULL_SPORT',
} as const;
export type PoolType = (typeof PoolType)[keyof typeof PoolType];
/** No natural order: A to Z by its display strings. */
export const PoolTypeOrder = alphabeticalOrder('PoolType');

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
/** No natural order: A to Z by its display strings. */
export const ContestFormatOrder = alphabeticalOrder('ContestFormat');

/**
 * Where one match of an event stands (#698). A match is COMPLETED once its result is in; a
 * CANCELLED one was never played. A POSTPONED one was put off before it began (#1791): it is
 * still to be played, at its new time once one is set, and its picks lock at that time as a
 * SCHEDULED game's do.
 */
export const MatchStatus = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  POSTPONED: 'POSTPONED',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];
/** The lifecycle, as an event's: postponed beside scheduled, cancelled last. */
export const MatchStatusOrder = explicitOrder<MatchStatus>({
  [MatchStatus.SCHEDULED]: 0,
  [MatchStatus.POSTPONED]: 1,
  [MatchStatus.IN_PROGRESS]: 2,
  [MatchStatus.COMPLETED]: 3,
  [MatchStatus.CANCELLED]: 4,
});

/**
 * One side of a match as a prediction names it (#698): HOME is side 2 and AWAY side 1
 * (`sideNumberOfMatchSide`). Match DTOs name sides by number (#2184); predictions and game
 * picks move to side numbers with #2016.
 */
export const MatchSide = {
  HOME: 'HOME',
  AWAY: 'AWAY',
} as const;
export type MatchSide = (typeof MatchSide)[keyof typeof MatchSide];
/** The order the values are declared in. */
export const MatchSideOrder = explicitOrder<MatchSide>({
  [MatchSide.HOME]: 0,
  [MatchSide.AWAY]: 1,
});

/**
 * How one side of a match came out (#2046), rolled up from the match's Games by the result writer
 * alone: PENDING until the match is decided, then WON and LOST, or TIED on both sides of a match
 * that can end level (`canEndTied`).
 */
export const MatchSideOutcome = {
  PENDING: 'PENDING',
  WON: 'WON',
  LOST: 'LOST',
  TIED: 'TIED',
} as const;
export type MatchSideOutcome = (typeof MatchSideOutcome)[keyof typeof MatchSideOutcome];
/** The order the values are declared in: undecided first. */
export const MatchSideOutcomeOrder = explicitOrder<MatchSideOutcome>({
  [MatchSideOutcome.PENDING]: 0,
  [MatchSideOutcome.WON]: 1,
  [MatchSideOutcome.LOST]: 2,
  [MatchSideOutcome.TIED]: 3,
});

/**
 * Where one side played one Game (#2046): at home, away, or NONE at a neutral site. Stored per
 * Game, since home court alternates in a series; screens say "at" or "vs" from it.
 */
export const HomeAway = {
  HOME: 'HOME',
  AWAY: 'AWAY',
  NONE: 'NONE',
} as const;
export type HomeAway = (typeof HomeAway)[keyof typeof HomeAway];
/** The order the values are declared in. */
export const HomeAwayOrder = explicitOrder<HomeAway>({
  [HomeAway.HOME]: 0,
  [HomeAway.AWAY]: 1,
  [HomeAway.NONE]: 2,
});

/**
 * What one period score counts (#2046): a period of play, an overtime period, or a shoot-out's
 * kicks scored (one SHOOTOUT period, never part of the Game's score).
 */
export const PeriodKind = {
  REGULAR: 'REGULAR',
  OVERTIME: 'OVERTIME',
  SHOOTOUT: 'SHOOTOUT',
} as const;
export type PeriodKind = (typeof PeriodKind)[keyof typeof PeriodKind];
/** The order they are played in. */
export const PeriodKindOrder = explicitOrder<PeriodKind>({
  [PeriodKind.REGULAR]: 0,
  [PeriodKind.OVERTIME]: 1,
  [PeriodKind.SHOOTOUT]: 2,
});

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
/** The order the values are declared in. */
export const MatchEndingOrder = explicitOrder<MatchEnding>({
  [MatchEnding.PLAYED]: 0,
  [MatchEnding.RETIREMENT]: 1,
  [MatchEnding.WALKOVER]: 2,
  [MatchEnding.DEFAULT]: 3,
});

/**
 * What screens call a sport league when its sport's noun does not fit (#834): the NCAA Division I
 * tennis championships are leagues, where the ATP and the WTA are tours. A sport league with
 * none set takes its sport's (`sport.<SPORT>.sportLeague`); read through `sportLeagueNounOf`.
 */
export const SportLeagueNoun = {
  LEAGUE: 'LEAGUE',
} as const;
export type SportLeagueNoun = (typeof SportLeagueNoun)[keyof typeof SportLeagueNoun];
/** No natural order: A to Z by its display strings. */
export const SportLeagueNounOrder = alphabeticalOrder('SportLeagueNoun');

/**
 * How one side's part in a FIELD Game ended (#2008): a runner's race (#622), a golfer's round.
 * Only a FINISHED side has a finishing place; in a race every other status scores the contest's
 * "did not finish" points. A horse scratched before the start is WITHDRAWN on the field, not
 * here. A head-to-head Game's side results have none.
 */
export const GameSideStatus = {
  FINISHED: 'FINISHED',
  DID_NOT_FINISH: 'DID_NOT_FINISH',
  DISQUALIFIED: 'DISQUALIFIED',
  DID_NOT_START: 'DID_NOT_START',
} as const;
export type GameSideStatus = (typeof GameSideStatus)[keyof typeof GameSideStatus];
/** The order the values are declared in. */
export const GameSideStatusOrder = explicitOrder<GameSideStatus>({
  [GameSideStatus.FINISHED]: 0,
  [GameSideStatus.DID_NOT_FINISH]: 1,
  [GameSideStatus.DISQUALIFIED]: 2,
  [GameSideStatus.DID_NOT_START]: 3,
});

/** Why one row of a race's finishing order cannot be applied (#622). */
export const RaceResultRowError = {
  DUPLICATE_PARTICIPANT: 'DUPLICATE_PARTICIPANT',
  POSITION_WITHOUT_FINISH: 'POSITION_WITHOUT_FINISH',
  FINISH_WITHOUT_POSITION: 'FINISH_WITHOUT_POSITION',
} as const;
export type RaceResultRowError = (typeof RaceResultRowError)[keyof typeof RaceResultRowError];
/** No natural order: A to Z by its display strings. */
export const RaceResultRowErrorOrder = alphabeticalOrder('RaceResultRowError');

/** Why a race's finishing order as a whole cannot be applied (#622). */
export const RaceResultOrderError = {
  POSITIONS_INVALID: 'POSITIONS_INVALID',
  FIELD_INCOMPLETE: 'FIELD_INCOMPLETE',
} as const;
export type RaceResultOrderError = (typeof RaceResultOrderError)[keyof typeof RaceResultOrderError];
/** No natural order: A to Z by its display strings. */
export const RaceResultOrderErrorOrder = alphabeticalOrder('RaceResultOrderError');

/** What applying one row of a finishing order would do to the runner's stored result (#622). */
export const RaceResultChange = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  UNCHANGED: 'UNCHANGED',
} as const;
export type RaceResultChange = (typeof RaceResultChange)[keyof typeof RaceResultChange];
/** The order the values are declared in. */
export const RaceResultChangeOrder = explicitOrder<RaceResultChange>({
  [RaceResultChange.CREATE]: 0,
  [RaceResultChange.UPDATE]: 1,
  [RaceResultChange.UNCHANGED]: 2,
});

/** What applying one row of a golf round-score upload would do to the golfer's stored round. */
export const GolfRoundScoreChange = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  UNCHANGED: 'UNCHANGED',
  /** The row has no strokes, so applying stores nothing for it. */
  SKIPPED: 'SKIPPED',
} as const;
export type GolfRoundScoreChange = (typeof GolfRoundScoreChange)[keyof typeof GolfRoundScoreChange];
/** The order the values are declared in. */
export const GolfRoundScoreChangeOrder = explicitOrder<GolfRoundScoreChange>({
  [GolfRoundScoreChange.CREATE]: 0,
  [GolfRoundScoreChange.UPDATE]: 1,
  [GolfRoundScoreChange.UNCHANGED]: 2,
  [GolfRoundScoreChange.SKIPPED]: 3,
});

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
/** No natural order: A to Z by its display strings. */
export const SelectionTypeOrder = alphabeticalOrder('SelectionType');

/**
 * How a contest made from a template covers the template's slot definitions (#2010, plan §7).
 * ONE_SLOT: the commissioner picks one of them (tiered, budget, sweepstakes, squares, a week's
 * pick'em). ALL_LISTED: every listed slot of one event (a bracket, a whole-playoffs pool).
 * FROM_SLOT: a starting slot and every later listed slot of its Season (survivor). Mirrors
 * `PrismaTemplateCoverageMode`.
 */
export const TemplateCoverageMode = {
  ONE_SLOT: 'ONE_SLOT',
  ALL_LISTED: 'ALL_LISTED',
  FROM_SLOT: 'FROM_SLOT',
} as const;
export type TemplateCoverageMode = (typeof TemplateCoverageMode)[keyof typeof TemplateCoverageMode];
/** From the narrowest coverage to the widest. */
export const TemplateCoverageModeOrder = explicitOrder<TemplateCoverageMode>({
  ONE_SLOT: 0,
  ALL_LISTED: 1,
  FROM_SLOT: 2,
});

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
/** The order the values are declared in. */
export const PickEmModeOrder = explicitOrder<PickEmMode>({
  [PickEmMode.STRAIGHT_UP]: 0,
  [PickEmMode.CONFIDENCE]: 1,
});

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
/** Undecided first, then right, push, wrong. */
export const PickOutcomeOrder = explicitOrder<PickOutcome>({
  [PickOutcome.PENDING]: 0,
  [PickOutcome.CORRECT]: 1,
  [PickOutcome.PUSH]: 2,
  [PickOutcome.BUSTED]: 3,
});

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
/** The order the values are declared in. */
export const PredictedResultOrder = explicitOrder<PredictedResult>({
  [PredictedResult.TEAM]: 0,
  [PredictedResult.TIE]: 1,
});

/**
 * How a survivor entry's week went (#719). SURVIVED: its team won, or its game was cancelled.
 * ELIMINATED: its team lost or tied, or the week started with no submitted pick, and that cost
 * the entry its last life. LIFE_LOST: the same, in a contest of two lives (#1754), costing a life
 * the entry stays in with. PENDING: its game is still to be decided.
 */
export const SurvivorWeekOutcome = {
  SURVIVED: 'SURVIVED',
  LIFE_LOST: 'LIFE_LOST',
  ELIMINATED: 'ELIMINATED',
  PENDING: 'PENDING',
} as const;
export type SurvivorWeekOutcome = (typeof SurvivorWeekOutcome)[keyof typeof SurvivorWeekOutcome];
/** Undecided first, then from best to worst. */
export const SurvivorWeekOutcomeOrder = explicitOrder<SurvivorWeekOutcome>({
  [SurvivorWeekOutcome.PENDING]: 0,
  [SurvivorWeekOutcome.SURVIVED]: 1,
  [SurvivorWeekOutcome.LIFE_LOST]: 2,
  [SurvivorWeekOutcome.ELIMINATED]: 3,
});

// --- Selection ---

export const SelectionStatus = {
  PENDING: 'PENDING',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
} as const;
export type SelectionStatus = (typeof SelectionStatus)[keyof typeof SelectionStatus];
/** The order the values are declared in. */
export const SelectionStatusOrder = explicitOrder<SelectionStatus>({
  [SelectionStatus.PENDING]: 0,
  [SelectionStatus.LIVE]: 1,
  [SelectionStatus.PAUSED]: 2,
  [SelectionStatus.COMPLETE]: 3,
});

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
/** The lifecycle, a postponed event beside the scheduled ones and a cancelled one last. */
export const SportEventStatusOrder = explicitOrder<SportEventStatus>({
  [SportEventStatus.DRAFT]: 0,
  [SportEventStatus.SCHEDULED]: 1,
  [SportEventStatus.POSTPONED]: 2,
  [SportEventStatus.IN_PROGRESS]: 3,
  [SportEventStatus.COMPLETED]: 4,
  [SportEventStatus.CANCELLED]: 5,
});

/** Statuses an event reaches only once it has started: under way, or over (finished or called off). */
export const STARTED_SPORT_EVENT_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.IN_PROGRESS,
  SportEventStatus.COMPLETED,
  SportEventStatus.CANCELLED,
];

/** Statuses that finish an event: its results are in, or will never come. Nothing moves out of them. */
export const FINISHED_SPORT_EVENT_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.COMPLETED,
  SportEventStatus.CANCELLED,
];

/** Statuses of an event that is not over: still to release, to start, put off, or under way. */
export const NOT_OVER_SPORT_EVENT_STATUSES: readonly SportEventStatus[] = Object.values(SportEventStatus)
  .filter((status) => !FINISHED_SPORT_EVENT_STATUSES.includes(status));

/** Whether the status says the event has started: under way, finished or called off. */
export function isSportEventStatusStarted(status: SportEventStatus): boolean {
  return STARTED_SPORT_EVENT_STATUSES.includes(status);
}

/** Whether the status finishes the event: completed or cancelled. */
export function isSportEventStatusFinished(status: SportEventStatus): boolean {
  return FINISHED_SPORT_EVENT_STATUSES.includes(status);
}

/**
 * Whether the event is past its contest cutoff: its start time has passed, or its status says it
 * has started or been called off. The server and the web both ask this one question (#117, #431).
 * A contest's window with no start yet (a later playoff round not yet scheduled, #2013) has started
 * only once its status says so.
 */
export function hasSportEventStarted(
  event: { status: SportEventStatus; startDate: Date | string | null },
  now: Date,
): boolean {
  if (isSportEventStatusStarted(event.status)) return true;
  if (event.startDate === null) return false;
  const startsAt = typeof event.startDate === 'string' ? Date.parse(event.startDate) : event.startDate.getTime();
  return startsAt <= now.getTime();
}

/**
 * The statuses an event can still take a contest in: released and not yet started (or moved), or a
 * knockout under way for a squares game to come. A finished or called
 * off event never can. Contest setup lists events in these statuses, and they bound what a
 * caller other than a root admin may list (#1348).
 */
export const OFFERABLE_SPORT_EVENT_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.SCHEDULED,
  SportEventStatus.POSTPONED,
  SportEventStatus.IN_PROGRESS,
];

/**
 * Whether a contest of one setup can be created on an event (#1007, #1929). OPEN: Create contest
 * would take it now. NOT_YET: the event is unreleased, its field not loaded, or a later-round
 * bracket's teams not set. CLOSED: the contest's cutoff on the event has passed.
 */
export const ContestOpening = {
  OPEN: 'OPEN',
  NOT_YET: 'NOT_YET',
  CLOSED: 'CLOSED',
} as const;
export type ContestOpening = (typeof ContestOpening)[keyof typeof ContestOpening];
/** Open first, then still to open, then too late. */
export const ContestOpeningOrder = explicitOrder<ContestOpening>({
  [ContestOpening.OPEN]: 0,
  [ContestOpening.NOT_YET]: 1,
  [ContestOpening.CLOSED]: 2,
});

/**
 * Why a contest of one setup does not open on an event now (#2015, #1932): the wait or the close
 * behind a NOT_YET or CLOSED `ContestOpening`. NOT_YET: EVENT_NOT_RELEASED (the event is a draft),
 * FIELD_NOT_LOADED (no field yet), FIELD_NOT_DECIDED (a contest picking from the field starts at a
 * slot with a team still to be decided by the matches feeding it, #2015), BRACKET_NOT_SET (the
 * teams of the bracket's games are not all known). CLOSED: EVENT_STARTED (the setup's cutoff on the event has passed), NO_GAME_LEFT (every
 * game a squares contest could be played on has kicked off).
 */
export const ContestOpeningReason = {
  EVENT_NOT_RELEASED: 'EVENT_NOT_RELEASED',
  FIELD_NOT_LOADED: 'FIELD_NOT_LOADED',
  FIELD_NOT_DECIDED: 'FIELD_NOT_DECIDED',
  BRACKET_NOT_SET: 'BRACKET_NOT_SET',
  EVENT_STARTED: 'EVENT_STARTED',
  NO_GAME_LEFT: 'NO_GAME_LEFT',
} as const;
export type ContestOpeningReason = (typeof ContestOpeningReason)[keyof typeof ContestOpeningReason];
/** The waits in the order they clear, then the closes. */
export const ContestOpeningReasonOrder = explicitOrder<ContestOpeningReason>({
  [ContestOpeningReason.EVENT_NOT_RELEASED]: 0,
  [ContestOpeningReason.FIELD_NOT_LOADED]: 1,
  [ContestOpeningReason.FIELD_NOT_DECIDED]: 2,
  [ContestOpeningReason.BRACKET_NOT_SET]: 3,
  [ContestOpeningReason.EVENT_STARTED]: 4,
  [ContestOpeningReason.NO_GAME_LEFT]: 5,
});

/** Where one provider sync run is in its lifecycle. */
export const ProviderSyncRunStatus = {
  SUBMITTED: 'SUBMITTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProviderSyncRunStatus = (typeof ProviderSyncRunStatus)[keyof typeof ProviderSyncRunStatus];
/** The order the values are declared in. */
export const ProviderSyncRunStatusOrder = explicitOrder<ProviderSyncRunStatus>({
  [ProviderSyncRunStatus.SUBMITTED]: 0,
  [ProviderSyncRunStatus.IN_PROGRESS]: 1,
  [ProviderSyncRunStatus.COMPLETED]: 2,
  [ProviderSyncRunStatus.FAILED]: 3,
  [ProviderSyncRunStatus.CANCELLED]: 4,
});

/** What a provider sync run syncs (#1819). */
export const ProviderSyncKind = {
  /** A sport league's events for a year: created, kept current with the provider. */
  EVENTS: 'EVENTS',
  /** One event's field. */
  FIELD: 'FIELD',
  /** One event's scores. */
  SCORES: 'SCORES',
  /** A sport league's roster for its current Season: each player's team and position (#2025). */
  ROSTER: 'ROSTER',
} as const;
export type ProviderSyncKind = (typeof ProviderSyncKind)[keyof typeof ProviderSyncKind];
/** The order the values are declared in. */
export const ProviderSyncKindOrder = explicitOrder<ProviderSyncKind>({
  [ProviderSyncKind.EVENTS]: 0,
  [ProviderSyncKind.FIELD]: 1,
  [ProviderSyncKind.SCORES]: 2,
  [ProviderSyncKind.ROSTER]: 3,
});

/**
 * Whether a sport league is in season (#2009): one of its Seasons' spans holds now
 * (`syncSeasonStateOf`). Each sync kind runs on its own interval for each state.
 */
export const SyncSeasonState = {
  IN_SEASON: 'IN_SEASON',
  OFFSEASON: 'OFFSEASON',
} as const;
export type SyncSeasonState = (typeof SyncSeasonState)[keyof typeof SyncSeasonState];
/** The order the values are declared in. */
export const SyncSeasonStateOrder = explicitOrder<SyncSeasonState>({
  [SyncSeasonState.IN_SEASON]: 0,
  [SyncSeasonState.OFFSEASON]: 1,
});

/**
 * How a sport event's latest automatic release check ended (#1847), as stored on the event. A
 * check that skips the event (released already, unsynced, outside its window) is not stored.
 */
export const AutoReleaseCheckOutcome = {
  /** Every ready check passed and the event was released. */
  RELEASED: 'RELEASED',
  /** A ready check failed: the event stays a draft until a later check passes. */
  HELD: 'HELD',
} as const;
export type AutoReleaseCheckOutcome = (typeof AutoReleaseCheckOutcome)[keyof typeof AutoReleaseCheckOutcome];
/** The order the values are declared in. */
export const AutoReleaseCheckOutcomeOrder = explicitOrder<AutoReleaseCheckOutcome>({
  [AutoReleaseCheckOutcome.RELEASED]: 0,
  [AutoReleaseCheckOutcome.HELD]: 1,
});

/**
 * Which ready check a DRAFT sport event must pass before it is released for contests (#1823):
 * each is passed or failed on the value it carries (`release-checks.ts`).
 */
export const ReleaseCheckKey = {
  /** Its start is still ahead: a started event can no longer be released. Value: the start. */
  NOT_STARTED: 'NOT_STARTED',
  /** Its rounds are scheduled. Value: how many rounds it has. */
  ROUNDS_SCHEDULED: 'ROUNDS_SCHEDULED',
  /** Its field is loaded. Value: how many participants are in it. */
  FIELD_LOADED: 'FIELD_LOADED',
  /** Every active field participant is in a tier. Value: how many are not. */
  TIERS_ASSIGNED: 'TIERS_ASSIGNED',
  /** No tier is empty: no entry could pick from one. Value: the empty tiers' labels. */
  TIERS_FILLED: 'TIERS_FILLED',
  /** Prices are assigned and every active field participant has one. Value: how many have none, or null before prices are assigned. */
  PRICES_ASSIGNED: 'PRICES_ASSIGNED',
  /** Its bracket is complete. Only an event played as matches has it. Value: what is missing, in words. */
  BRACKET_COMPLETE: 'BRACKET_COMPLETE',
  /** Its sport league offers at least one active contest setup, so a contest can be made on it. Value: how many. */
  CONTEST_SETUPS_ON: 'CONTEST_SETUPS_ON',
} as const;
export type ReleaseCheckKey = (typeof ReleaseCheckKey)[keyof typeof ReleaseCheckKey];
/** Check order: the order the checks are judged and listed in. */
export const ReleaseCheckKeyOrder = explicitOrder<ReleaseCheckKey>({
  [ReleaseCheckKey.NOT_STARTED]: 0,
  [ReleaseCheckKey.ROUNDS_SCHEDULED]: 1,
  [ReleaseCheckKey.FIELD_LOADED]: 2,
  [ReleaseCheckKey.TIERS_ASSIGNED]: 3,
  [ReleaseCheckKey.TIERS_FILLED]: 4,
  [ReleaseCheckKey.PRICES_ASSIGNED]: 5,
  [ReleaseCheckKey.BRACKET_COMPLETE]: 6,
  [ReleaseCheckKey.CONTEST_SETUPS_ON]: 7,
});

/**
 * A sport league's sync health on the root admin's Sports page (#1847), from the latest finished
 * run of each of its syncs: its event list, and its events' fields and scores.
 */
export const SportLeagueSyncHealth = {
  /** The latest finished run of every sync it has run worked. */
  OK: 'OK',
  /** The latest finished run of at least one sync failed; its SYNC issue names which. */
  ERROR: 'ERROR',
  /** It is on and has a provider, but no sync has finished a run yet. */
  NOT_RUN_YET: 'NOT_RUN_YET',
  /** It is off, or no provider syncs it: nothing runs. */
  OFF: 'OFF',
} as const;
export type SportLeagueSyncHealth = (typeof SportLeagueSyncHealth)[keyof typeof SportLeagueSyncHealth];
/** Derek's order (#1847): healthy first, off last. */
export const SportLeagueSyncHealthOrder = explicitOrder<SportLeagueSyncHealth>({
  [SportLeagueSyncHealth.OK]: 0,
  [SportLeagueSyncHealth.ERROR]: 1,
  [SportLeagueSyncHealth.NOT_RUN_YET]: 2,
  [SportLeagueSyncHealth.OFF]: 3,
});

/**
 * What needs a root admin on a sport league (#1847): one chip per type on the Sports page. No
 * linking type: the sync matches participants by feed id alone (#1850), so none waits for a link.
 */
export const SportLeagueIssueType = {
  /** The league's OPEN sync findings (#1999), counted by severity. */
  FINDINGS: 'FINDINGS',
  /** A sync whose latest finished run failed. */
  SYNC: 'SYNC',
  /** A draft event whose latest automatic release check held it. */
  RELEASE: 'RELEASE',
} as const;
export type SportLeagueIssueType = (typeof SportLeagueIssueType)[keyof typeof SportLeagueIssueType];
/** The fixed order the chips show in (#1847, #1999). A Game whose result is overdue is a GAME_OVERDUE finding (#2013). */
export const SportLeagueIssueTypeOrder = explicitOrder<SportLeagueIssueType>({
  [SportLeagueIssueType.FINDINGS]: 0,
  [SportLeagueIssueType.SYNC]: 1,
  [SportLeagueIssueType.RELEASE]: 2,
});

/** How serious a sync finding is (#1999): an ERROR also raises the alarm when it opens. */
export const ProviderSyncFindingSeverity = {
  /** Synced data is wrong or missing until someone acts. */
  ERROR: 'ERROR',
  /** Something the sync skipped or guessed at; worth a look. */
  WARNING: 'WARNING',
  /** Something the sync noticed and left alone on purpose. */
  INFO: 'INFO',
} as const;
export type ProviderSyncFindingSeverity = (typeof ProviderSyncFindingSeverity)[keyof typeof ProviderSyncFindingSeverity];
/** Most serious first: the order a list and the Sports page's counts show them in. */
export const ProviderSyncFindingSeverityOrder = explicitOrder<ProviderSyncFindingSeverity>({
  [ProviderSyncFindingSeverity.ERROR]: 0,
  [ProviderSyncFindingSeverity.WARNING]: 1,
  [ProviderSyncFindingSeverity.INFO]: 2,
});

/**
 * Where a sync finding stands (#1999). The sync raises it OPEN; it is RESOLVED when the sync
 * stops seeing it or an admin fixes it, and WAIVED when an admin accepts it, with a note. A
 * waived finding stays waived when the sync sees it again; a resolved one opens again.
 */
export const ProviderSyncFindingStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  WAIVED: 'WAIVED',
} as const;
export type ProviderSyncFindingStatus = (typeof ProviderSyncFindingStatus)[keyof typeof ProviderSyncFindingStatus];
/** The order the values are declared in. */
export const ProviderSyncFindingStatusOrder = explicitOrder<ProviderSyncFindingStatus>({
  [ProviderSyncFindingStatus.OPEN]: 0,
  [ProviderSyncFindingStatus.RESOLVED]: 1,
  [ProviderSyncFindingStatus.WAIVED]: 2,
});

/**
 * What a sync finding is about (#1999). Each kind names its subject: the sport league always,
 * then the event, the Provider and the provider's own value where the kind has them. Later
 * slices add their kinds here, with their actions.
 */
export const ProviderSyncFindingKind = {
  /**
   * A Provider has rate limited every call for a while (league model 1c), so its syncs keep
   * being put off: a WARNING after a quarter of an hour, an ERROR once it has lasted the
   * league's quiet threshold (`ProviderLeague.quietAfterMinutes`). Resolved by the Provider's
   * next answer. Subject: each league it syncs, and the Provider.
   */
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  /**
   * The feed sent a participant id no participant of the league is mapped to, so its results
   * had nowhere to land. Subject: league, Provider and the provider's participant id.
   */
  UNMAPPED_PARTICIPANT: 'UNMAPPED_PARTICIPANT',
  /**
   * A Provider's webhooks are switched on but its signing secret is not set in this
   * environment, so its notifications are refused. Subject: each league it syncs, and the
   * Provider.
   */
  WEBHOOK_SECRET_MISSING: 'WEBHOOK_SECRET_MISSING',
  /**
   * The league's events sync has no Season to read from its selected Provider (#2003): its last
   * Season mapped to the Provider has ended and no later one is mapped. Seasons are added by
   * migration, so nothing of the next Season syncs until one lands. Subject: league and Provider.
   */
  SEASON_MISSING: 'SEASON_MISSING',
  /**
   * A field sync's provider sent the event with no participants. Subject: league, event, Provider
   * and the FIELD sync; the next field sync with participants resolves it.
   */
  NO_PROVIDER_PARTICIPANTS: 'NO_PROVIDER_PARTICIPANTS',
  /**
   * A scores sync's provider sent no live-score updates for the event. Subject: league, event,
   * Provider and the SCORES sync; the next scores sync with updates resolves it.
   */
  NO_PROVIDER_LIVE_SCORES: 'NO_PROVIDER_LIVE_SCORES',
  /**
   * The provider listed games with the event's field, but they were not written to the event.
   * Subject: league, event and Provider; the next field follow-up that writes them resolves it.
   */
  GAMES_NOT_SYNCED: 'GAMES_NOT_SYNCED',
  /**
   * The events sync read a code the provider names a game's place by (`REG:5`, `POST:3`, a
   * tournament id) that none of the league's slot provider mappings includes (#2005): its games are
   * not synced. INFO, since a preseason week or an all-star game is left out on purpose; waiving it
   * marks the code as known and excluded, and the sync then leaves it quiet. Subject: league,
   * Provider and the code.
   */
  SLOT_VALUE_UNMAPPED: 'SLOT_VALUE_UNMAPPED',
  /**
   * The league's selected provider mapping names a provider league code its Provider does not read
   * (#2005): no enabled league row of the sport has the code, or the adapter has no reader for it.
   * Nothing is read, rather than every league of the sport, and the events sync fails until the
   * mapping or the league row is fixed. ERROR. Subject: league and Provider.
   */
  PROVIDER_LEAGUE_UNKNOWN: 'PROVIDER_LEAGUE_UNKNOWN',
  /**
   * The events sync read a tournament that no code places and whose normalized name no NAME_PATTERN
   * mapping of the league matches (#2011): no Season slot is created and it is not synced. INFO,
   * as for an unmapped code (inclusion only). "Link to existing" adds its name as a pattern of a
   * slot definition; a tournament with no definition waits for the migration that adds one.
   * Subject: league, Provider and the normalized name, with the feed's name.
   */
  SLOT_NAME_UNMATCHED: 'SLOT_NAME_UNMATCHED',
  /**
   * A tournament's normalized name matched the NAME_PATTERN mappings of more than one slot
   * definition, or of one whose Season slot another tournament is already linked to (#2011): it is
   * linked to none. ERROR, since a tournament the league plays is missing until the patterns are
   * fixed. Subject: league, Provider and the normalized name, with the feed's name.
   */
  SLOT_NAME_AMBIGUOUS: 'SLOT_NAME_AMBIGUOUS',
  /**
   * A tournament's normalized name matched one slot definition, but the Season has no competition
   * for that definition's competition, so no Season slot could be made and the tournament is not
   * synced (#2011, #2153). ERROR, since a tournament the league plays is missing until the Season's
   * competition is added. Subject: league, Provider and the normalized name, with the feed's name.
   */
  SLOT_SEASON_COMPETITION_MISSING: 'SLOT_SEASON_COMPETITION_MISSING',
  /**
   * The events sync placed games in a Season slot dated outside the Season's span (#2012): before
   * it starts or after it ends. The games are still written. WARNING, since the Season row's span
   * is what to check. Subject: league, Provider and the code.
   */
  SLOT_OUTSIDE_SEASON: 'SLOT_OUTSIDE_SEASON',
  /**
   * The events sync read games whose feed names no place for them (no round or week) that no
   * Season slot's date window holds (#2012): they are not synced. INFO, since a feed with no round
   * marker lists every game of its days (college football's other bowls); inclusion only. Only
   * games inside the Season's span count. Subject: league, Provider and the provider's id for the
   * Season.
   */
  GAMES_UNPLACED: 'GAMES_UNPLACED',
  /**
   * A Season still open or to come has slots its provider places by date window whose window is
   * missing or still tentative (#2012, #1924): games in them may not be placed. WARNING; it
   * resolves once every such slot of the Season has a confirmed window. Subject: league, Provider
   * and the provider's id for the Season.
   */
  SLOT_DATES_NEEDED: 'SLOT_DATES_NEEDED',
  /**
   * A field sync wrote an event's field, but no active participant has a value for any source its
   * sport league's tier and pricing profiles list (#2160), so it was not tiered or priced. WARNING.
   * Subject: league, event and Provider; the next field follow-up that orders the field resolves it.
   */
  FIELD_HAS_NO_ORDER: 'FIELD_HAS_NO_ORDER',
  /**
   * A provider's webhook named a game id no Game is mapped to (#2007): nothing is synced for it,
   * since a notification routes only to the Game its id is mapped to. WARNING; a schedule sync
   * that maps the id, or a game the provider dropped, leaves it to resolve by hand. Subject:
   * league, Provider and the provider's game id.
   */
  GAME_UNKNOWN: 'GAME_UNKNOWN',
  /**
   * The provider re-issued a game's id (#2007): a game with a new id was placed by its match's
   * teams and its game number at a Game mapped to an old id the feed no longer sends. The mapping
   * moved to the new id. WARNING. Subject: league, event, Provider and the new id.
   */
  GAME_ID_REISSUED: 'GAME_ID_REISSUED',
  /**
   * The provider moved a game to another event (#2007), such as a game moved to another week: the
   * old Game is kept with its picks, marked moved to the Game the game is played at now, and the
   * mapping moved with it. WARNING until picks on the old Game are voided (#2016). Subject:
   * league, the event it moved to, Provider and the provider's game id.
   */
  GAME_MOVED: 'GAME_MOVED',
  /**
   * A slot's tiebreaker game was cancelled or moved to another slot (#2048), so the rule chose
   * another; entries' guesses carry over to it. WARNING. Subject: league and event; no Provider or
   * value, since the choice is the app's own. A root admin resolves it once they have checked the new game.
   */
  TIEBREAKER_GAME_REPLACED: 'TIEBREAKER_GAME_REPLACED',
  /**
   * A released event playing a rest-of-phase slot (a season's bowls) holds an active team none of
   * whose games is placed in its slots any more (#2223): the game moved to another slot, such as a
   * CFP game placed once its seeds were. A draft withdraws such a team by itself (#2221); a
   * released event keeps it, since a contest may already hold it, so a contest offers a team that
   * plays none of its games. WARNING. Subject: league, event, Provider and the team's feed id, with
   * its name; the field sync that finds the team's game back in the slots, or the team withdrawn,
   * resolves it.
   */
  FIELD_TEAM_WITHOUT_GAME: 'FIELD_TEAM_WITHOUT_GAME',
  /**
   * A sync run ended FAILED (#2092): its feed threw, its job failed, or an earlier try stopped
   * mid-run. ERROR. Subject: league, event (none for a league's events sync), Provider and the
   * run's sync kind; the finding names the latest run that failed. The next COMPLETED run of the
   * same subject resolves it. The Sports page's Sync chip lists these.
   */
  SYNC_FAILED: 'SYNC_FAILED',
  /**
   * A field sync's feed put a team in a conference code the league's provider mapping has no row
   * for (#2052): the team gets no conference for the Season. WARNING, since a conference the league
   * plays is missing until a migration adds it. Only a league that names conference codes raises
   * it. Subject: league, Provider and the code, with the team's name.
   */
  CONFERENCE_UNMAPPED: 'CONFERENCE_UNMAPPED',
  /**
   * A field sync's feed put a team in a division code its conference has no row for (#2052): the
   * team is written with its conference and no division. WARNING. Subject: league, Provider and the
   * code, with the conference's name.
   */
  DIVISION_UNMAPPED: 'DIVISION_UNMAPPED',
  /**
   * A Season still open or to come has slots whose competition names a conference that no team
   * holds in the Season yet (#2052): the slots place no game, since a conference's slot takes only
   * its teams' games and the field sync writes a team's Season conference. WARNING; it resolves once
   * every such slot's conference has teams. Subject: league, Provider and the provider's id for the
   * Season, naming the slots.
   */
  CONFERENCE_TEAMS_MISSING: 'CONFERENCE_TEAMS_MISSING',
  /**
   * A league's box scores were asked of a Provider whose plan includes no player stats (#2026):
   * the Provider row's `hasPlayerStats` is off, or the provider refused the league's stats reads.
   * Nothing is read or written. ERROR, since a league that offers stat contests cannot score them.
   * Subject: league and Provider; a box score read that succeeds resolves it.
   */
  PROVIDER_PLAN_HAS_NO_STATS: 'PROVIDER_PLAN_HAS_NO_STATS',
  /**
   * A box score named a player who plays no side of the Game (#2026): neither the player's own
   * field row nor their Season roster row's team is a side of the Game's Match, or the player has
   * no roster row in the Season. Their stat rows are refused; the rest of the box score is written.
   * WARNING. Subject: league, event, Provider and the player's feed id, with their name.
   */
  BOX_SCORE_PLAYER_NOT_IN_GAME: 'BOX_SCORE_PLAYER_NOT_IN_GAME',
  /**
   * A Game is still scheduled or in progress more than the overdue wait after it should have ended
   * (#2013): its scheduled start plus its provider league's typical game length (`gameOverdueExpectedEnd`).
   * WARNING, since its result has not come from the feed. The sync tick raises it, once per overdue
   * wait it stays so, and resolves it once the Game is no longer overdue: finished, cancelled,
   * postponed or moved to another start. Subject: league, event, Provider and the provider's game id.
   */
  GAME_OVERDUE: 'GAME_OVERDUE',
  /**
   * A draft contest picking from the field (tiered, budget, sweepstakes) reached its cutoff while
   * a game of its first slot still waited for a team (#2015): it opens only once every team of that
   * slot is known, so it can never open. The league's schedule overlaps its rounds. WARNING.
   * Subject: league and event; no Provider or value, since the rule is the app's own. The lifecycle
   * raises it while such a draft's slot is undecided; a root admin resolves it.
   */
  FIELD_CONTEST_CANNOT_OPEN: 'FIELD_CONTEST_CANNOT_OPEN',
} as const;
export type ProviderSyncFindingKind = (typeof ProviderSyncFindingKind)[keyof typeof ProviderSyncFindingKind];
export const ProviderSyncFindingKindOrder = alphabeticalOrder('ProviderSyncFindingKind');

/** What an admin can do with a sync finding (#1999); the API says which each finding offers. */
export const ProviderSyncFindingAction = {
  /** Map the provider's participant id to a participant of the league (UNMAPPED_PARTICIPANT). */
  MAP_PARTICIPANT: 'MAP_PARTICIPANT',
  /** Add the tournament's name as a pattern of one of the league's slot definitions (SLOT_NAME_UNMATCHED). */
  LINK_SLOT: 'LINK_SLOT',
  /** Mark it fixed. */
  RESOLVE: 'RESOLVE',
  /** Accept it as it is, with a note. */
  WAIVE: 'WAIVE',
  /** Open a resolved or waived finding again. */
  REOPEN: 'REOPEN',
} as const;
export type ProviderSyncFindingAction = (typeof ProviderSyncFindingAction)[keyof typeof ProviderSyncFindingAction];
/** The order the dialog's Actions section lists them in. */
export const ProviderSyncFindingActionOrder = explicitOrder<ProviderSyncFindingAction>({
  [ProviderSyncFindingAction.MAP_PARTICIPANT]: 0,
  [ProviderSyncFindingAction.LINK_SLOT]: 1,
  [ProviderSyncFindingAction.RESOLVE]: 2,
  [ProviderSyncFindingAction.WAIVE]: 3,
  [ProviderSyncFindingAction.REOPEN]: 4,
});

/** How a sport event is released for contests, on the League page (#1865). */
export const SportEventReleaseMode = {
  /** Its sport league releases its synced drafts on their own, a window before the start. */
  AUTO: 'AUTO',
  /** A root admin releases it. */
  MANUAL: 'MANUAL',
} as const;
export type SportEventReleaseMode = (typeof SportEventReleaseMode)[keyof typeof SportEventReleaseMode];
/** The order the values are declared in. */
export const SportEventReleaseModeOrder = explicitOrder<SportEventReleaseMode>({
  [SportEventReleaseMode.AUTO]: 0,
  [SportEventReleaseMode.MANUAL]: 1,
});

/** What a sport event's release date is, on the League page (#1865). */
export const SportEventReleaseAtKind = {
  /** When the automatic release window opens for a draft: its start less the league's window. */
  PLANNED: 'PLANNED',
  /** When it was released. */
  ACTUAL: 'ACTUAL',
} as const;
export type SportEventReleaseAtKind = (typeof SportEventReleaseAtKind)[keyof typeof SportEventReleaseAtKind];
/** Planned comes before actual, as a release does. */
export const SportEventReleaseAtKindOrder = explicitOrder<SportEventReleaseAtKind>({
  [SportEventReleaseAtKind.PLANNED]: 0,
  [SportEventReleaseAtKind.ACTUAL]: 1,
});

/** Who added a participant to its sport league, on the League page (#1865). */
export const ParticipantAddedBy = {
  /** A sync found it in its provider's feed: it has a provider mapping. */
  FEED: 'FEED',
  /** A root admin added it: it has no provider mapping. */
  ADMIN: 'ADMIN',
} as const;
export type ParticipantAddedBy = (typeof ParticipantAddedBy)[keyof typeof ParticipantAddedBy];
/** No natural order: A to Z by its display strings. */
export const ParticipantAddedByOrder = alphabeticalOrder('ParticipantAddedBy');

/** What runs a sport league's sync next, on the League page (#1865). */
export const SportLeagueSyncMode = {
  /** The ingestion schedule's interval for the sync. */
  SCHEDULE: 'SCHEDULE',
  /** The provider's webhook, with a safety-net poll while an event is in play. */
  WEBHOOK: 'WEBHOOK',
} as const;
export type SportLeagueSyncMode = (typeof SportLeagueSyncMode)[keyof typeof SportLeagueSyncMode];
/** The order the values are declared in. */
export const SportLeagueSyncModeOrder = explicitOrder<SportLeagueSyncMode>({
  [SportLeagueSyncMode.SCHEDULE]: 0,
  [SportLeagueSyncMode.WEBHOOK]: 1,
});

/** What an issue item opens (#1847). */
export const SportLeagueIssueTargetType = {
  /** A provider sync run, on the run log. */
  SYNC_RUN: 'SYNC_RUN',
  /** A sport event, on its event page. */
  SPORT_EVENT: 'SPORT_EVENT',
} as const;
export type SportLeagueIssueTargetType = (typeof SportLeagueIssueTargetType)[keyof typeof SportLeagueIssueTargetType];
/** Lined up with the issue types they belong to. */
export const SportLeagueIssueTargetTypeOrder = explicitOrder<SportLeagueIssueTargetType>({
  [SportLeagueIssueTargetType.SYNC_RUN]: 0,
  [SportLeagueIssueTargetType.SPORT_EVENT]: 1,
});

/**
 * What started a background job or a provider sync run (#1861; sync runs since #1819). One set of
 * values for both: a sync run records its job's. A person's start is split by the role the route
 * they acted through requires (Derek 2026-11-18). There is no member trigger: a member's own
 * action never queues a job of its own (`rules/architecture-rules.md` §4).
 */
export const JobTrigger = {
  /** A timer: a recurring sweep or the sync's own schedule. */
  SCHEDULE: 'SCHEDULE',
  /** The provider's webhook said something changed. */
  WEBHOOK: 'WEBHOOK',
  /** A root admin route, such as Sync now or Release; the job names the admin. */
  ADMIN: 'ADMIN',
  /** A league's commissioner tools, such as opening a contest, which queues its email; the job names them. */
  COMMISSIONER: 'COMMISSIONER',
  /**
   * Another job, such as settling once a sync finds final scores, or emails after a release; and
   * the upkeep a member's request asks for, such as rebuilding a contest's stale board, which is
   * queued once per contest, never per member action.
   */
  SYSTEM: 'SYSTEM',
} as const;
export type JobTrigger = (typeof JobTrigger)[keyof typeof JobTrigger];
/** The order the values are declared in. */
export const JobTriggerOrder = explicitOrder<JobTrigger>({
  [JobTrigger.SCHEDULE]: 0,
  [JobTrigger.WEBHOOK]: 1,
  [JobTrigger.ADMIN]: 2,
  [JobTrigger.COMMISSIONER]: 3,
  [JobTrigger.SYSTEM]: 4,
});

/**
 * The triggers that name a person (#1861): the role the route they acted through requires, not
 * their highest role, so a root admin using a league's commissioner tools is a COMMISSIONER.
 */
export const PERSON_JOB_TRIGGERS = [JobTrigger.ADMIN, JobTrigger.COMMISSIONER] as const;
export type PersonJobTrigger = (typeof PERSON_JOB_TRIGGERS)[number];

/**
 * Why a background job did not do its work (#1861), beside its error message. Set with the error
 * of a failed try (and kept while it waits to be retried, or once FAILED), and on a job that
 * finished but was held back, such as a release whose ready checks failed. Null on a job that
 * did its work.
 */
export const JobErrorType = {
  /** The provider answered 429: too many requests for the plan's rate limit. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** A request was given up on for taking too long, or never answered. */
  TIMEOUT: 'TIMEOUT',
  /** The provider answered with an error, or refused the read. */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** What came back, or what the job was given, did not have the shape the job relies on. */
  BAD_DATA: 'BAD_DATA',
  /** A check the job runs first did not pass, such as an event's ready checks before release. */
  CHECK_FAILED: 'CHECK_FAILED',
  /** Anything else. */
  OTHER: 'OTHER',
} as const;
export type JobErrorType = (typeof JobErrorType)[keyof typeof JobErrorType];
/** The order the values are declared in. */
export const JobErrorTypeOrder = explicitOrder<JobErrorType>({
  [JobErrorType.RATE_LIMITED]: 0,
  [JobErrorType.TIMEOUT]: 1,
  [JobErrorType.PROVIDER_ERROR]: 2,
  [JobErrorType.BAD_DATA]: 3,
  [JobErrorType.CHECK_FAILED]: 4,
  [JobErrorType.OTHER]: 5,
});

/** Where one in-memory ingestion job is; a provider sync run records the job's outcome. */
export const IngestionJobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type IngestionJobStatus = (typeof IngestionJobStatus)[keyof typeof IngestionJobStatus];
/** The order the values are declared in. */
export const IngestionJobStatusOrder = explicitOrder<IngestionJobStatus>({
  [IngestionJobStatus.PENDING]: 0,
  [IngestionJobStatus.RUNNING]: 1,
  [IngestionJobStatus.COMPLETED]: 2,
  [IngestionJobStatus.FAILED]: 3,
});

/**
 * Where one round of an event stands (#1889), read off the results recorded in it: its matches',
 * or its participants' rounds where it has no matches. Not stored.
 */
export const RoundStatus = {
  /** Nothing in it has started: no match under way or finished, no participant round recorded. */
  SCHEDULED: 'SCHEDULED',
  /** Some of it is under way or finished, not all of it. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Every match finished or cancelled, or every recorded participant round finished. */
  COMPLETED: 'COMPLETED',
} as const;
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus];
/** The lifecycle order. */
export const RoundStatusOrder = explicitOrder<RoundStatus>({
  [RoundStatus.SCHEDULED]: 0,
  [RoundStatus.IN_PROGRESS]: 1,
  [RoundStatus.COMPLETED]: 2,
});

/**
 * Where a provider says a game stands (#1496), as a `GAME` live-score update reports it. Only a
 * FINAL game decides its match; the others write no result.
 */
export const ProviderGameState = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  FINAL: 'FINAL',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProviderGameState = (typeof ProviderGameState)[keyof typeof ProviderGameState];
/** The lifecycle, as an event's: postponed beside scheduled, cancelled last. */
export const ProviderGameStateOrder = explicitOrder<ProviderGameState>({
  [ProviderGameState.SCHEDULED]: 0,
  [ProviderGameState.POSTPONED]: 1,
  [ProviderGameState.IN_PROGRESS]: 2,
  [ProviderGameState.FINAL]: 3,
  [ProviderGameState.CANCELLED]: 4,
});

/**
 * A field row's place in its event (SportEventParticipant.status, #2184): still in the field,
 * or out of it and why. Cross-sport: a golfer who missed the cut is ELIMINATED, as is a
 * knocked-out team; golf screens call ELIMINATED "Cut" through the sport's words.
 */
export const SportEventParticipantStatus = {
  ACTIVE: 'ACTIVE',
  WITHDRAWN: 'WITHDRAWN',
  ELIMINATED: 'ELIMINATED',
  DISQUALIFIED: 'DISQUALIFIED',
} as const;
export type SportEventParticipantStatus =
  (typeof SportEventParticipantStatus)[keyof typeof SportEventParticipantStatus];
/** The order the values are declared in: in the field first, then each way out of it. */
export const SportEventParticipantStatusOrder = explicitOrder<SportEventParticipantStatus>({
  [SportEventParticipantStatus.ACTIVE]: 0,
  [SportEventParticipantStatus.WITHDRAWN]: 1,
  [SportEventParticipantStatus.ELIMINATED]: 2,
  [SportEventParticipantStatus.DISQUALIFIED]: 3,
});

/**
 * A participant's live state within one event (SportEventParticipantStanding.status).
 * Cross-sport: ELIMINATED covers a golfer who missed the cut as well as a
 * knocked-out team, matching SportEventParticipantStatus.
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
/** The order the values are declared in. */
export const ParticipantStandingStatusOrder = explicitOrder<ParticipantStandingStatus>({
  [ParticipantStandingStatus.ACTIVE]: 0,
  [ParticipantStandingStatus.IN_PROGRESS]: 1,
  [ParticipantStandingStatus.COMPLETE]: 2,
  [ParticipantStandingStatus.WITHDRAWN]: 3,
  [ParticipantStandingStatus.ELIMINATED]: 4,
});

// --- Contest Lifecycle ---

export const ContestStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
} as const;
export type ContestStatus = (typeof ContestStatus)[keyof typeof ContestStatus];
/** The order the values are declared in. */
export const ContestStatusOrder = explicitOrder<ContestStatus>({
  [ContestStatus.DRAFT]: 0,
  [ContestStatus.OPEN]: 1,
  [ContestStatus.ACTIVE]: 2,
  [ContestStatus.COMPLETED]: 3,
});

/**
 * Statuses that make a contest count as active for a league's `activeContestCount`. DRAFT is
 * not one (#117): a draft is the commissioner's private setup, not a contest the league has.
 */
export const ACTIVE_LEAGUE_CONTEST_STATUSES = [
  ContestStatus.OPEN,
  ContestStatus.ACTIVE,
] as const;

/**
 * A named priority order (#1841): how League Home lists a league's current contests. Open
 * first, because that is where a step waits, then Live, then Set up (shown to commissioners
 * only). A final contest is not current, and the list leaves it out.
 */
export const ContestStatusOrderForHomeCurrent = explicitOrder<ContestStatus>({
  [ContestStatus.OPEN]: 0,
  [ContestStatus.ACTIVE]: 1,
  [ContestStatus.DRAFT]: 2,
  [ContestStatus.COMPLETED]: 3,
});

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
/** The order the values are declared in. */
export const ContestEntryStatusOrder = explicitOrder<ContestEntryStatus>({
  [ContestEntryStatus.DRAFT]: 0,
  [ContestEntryStatus.SUBMITTED]: 1,
});

// --- League ---

export const LeagueRole = {
  COMMISSIONER: 'COMMISSIONER',
  MEMBER: 'MEMBER',
} as const;
export type LeagueRole = (typeof LeagueRole)[keyof typeof LeagueRole];
/** The order the values are declared in. */
export const LeagueRoleOrder = explicitOrder<LeagueRole>({
  [LeagueRole.COMMISSIONER]: 0,
  [LeagueRole.MEMBER]: 1,
});

export const LeagueMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type LeagueMembershipStatus =
  (typeof LeagueMembershipStatus)[keyof typeof LeagueMembershipStatus];
/** The order the values are declared in. */
export const LeagueMembershipStatusOrder = explicitOrder<LeagueMembershipStatus>({
  [LeagueMembershipStatus.ACTIVE]: 0,
  [LeagueMembershipStatus.INACTIVE]: 1,
});

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
/** No natural order: A to Z by its display strings. */
export const LeagueIconKeyOrder = alphabeticalOrder('LeagueIconKey');

export const AuthProvider = {
  EMAIL: 'email',
  GOOGLE: 'google',
  APPLE: 'apple',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];
/** No natural order: A to Z by its display strings. */
export const AuthProviderOrder = alphabeticalOrder('AuthProvider');

export const TimeFormat = {
  TWELVE_HOUR: '12H',
  TWENTY_FOUR_HOUR: '24H',
} as const;
export type TimeFormat = (typeof TimeFormat)[keyof typeof TimeFormat];
/** The order the values are declared in. */
export const TimeFormatOrder = explicitOrder<TimeFormat>({
  [TimeFormat.TWELVE_HOUR]: 0,
  [TimeFormat.TWENTY_FOUR_HOUR]: 1,
});

/**
 * The member's Appearance choice. A user with none saved has no value: the website then follows
 * the device, and the mobile app opens dark (`rules/mobile-rules.md`).
 */
export const ColorScheme = {
  DEVICE: 'DEVICE',
  LIGHT: 'LIGHT',
  DARK: 'DARK',
} as const;
export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];
/** The order the values are declared in. */
export const ColorSchemeOrder = explicitOrder<ColorScheme>({
  [ColorScheme.DEVICE]: 0,
  [ColorScheme.LIGHT]: 1,
  [ColorScheme.DARK]: 2,
});


/**
 * How a SportEventSlotParticipantValuation's tier/price was set. See plans/124 §4.5. An automatic one
 * names the value that decided the field's order (#1807, `orderField`): the feed's odds, the seed
 * or the rank. A field with none of them is never tiered or priced automatically (#2040): a name
 * orders nothing (`rules/domain-model-conventions-rules.md` §17).
 */
export const ValuationSource = {
  AUTO_ODDS: 'AUTO_ODDS',
  AUTO_SEED: 'AUTO_SEED',
  AUTO_RANKING: 'AUTO_RANKING',
  MANUAL: 'MANUAL',
} as const;
export type ValuationSource = (typeof ValuationSource)[keyof typeof ValuationSource];
/** The order the values are declared in. */
export const ValuationSourceOrder = explicitOrder<ValuationSource>({
  [ValuationSource.AUTO_ODDS]: 0,
  [ValuationSource.AUTO_SEED]: 1,
  [ValuationSource.AUTO_RANKING]: 2,
  [ValuationSource.MANUAL]: 3,
});

/**
 * Who last set a field row's tier or price, as the root admin's Field grid shows it: automatic
 * tiering and pricing, or a root admin's correction (read from the row's ValuationSource).
 */
export const FieldValueSetBy = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;
export type FieldValueSetBy = (typeof FieldValueSetBy)[keyof typeof FieldValueSetBy];
/** Auto first, then the corrections. */
export const FieldValueSetByOrder = explicitOrder<FieldValueSetBy>({
  [FieldValueSetBy.AUTO]: 0,
  [FieldValueSetBy.MANUAL]: 1,
});

export const GolfCategoryKey = {
  SENIOR: 'SENIOR',
  ROOKIE: 'ROOKIE',
  PREVIOUS_WINNER: 'PREVIOUS_WINNER',
  US_PLAYER: 'US_PLAYER',
  INTERNATIONAL_PLAYER: 'INTERNATIONAL_PLAYER',
} as const;
export type GolfCategoryKey =
  (typeof GolfCategoryKey)[keyof typeof GolfCategoryKey];
/** No natural order: A to Z by its display strings. */
export const GolfCategoryKeyOrder = alphabeticalOrder('GolfCategoryKey');

export const GolfCutRuleType = {
  FIXED_SCORE: 'FIXED_SCORE',
} as const;
export type GolfCutRuleType =
  (typeof GolfCutRuleType)[keyof typeof GolfCutRuleType];
/** No natural order: A to Z by its display strings. */
export const GolfCutRuleTypeOrder = alphabeticalOrder('GolfCutRuleType');

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
/** No natural order: A to Z by its display strings. */
export const TeamIconKeyOrder = alphabeticalOrder('TeamIconKey');

export const SquadMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type SquadMembershipStatus =
  (typeof SquadMembershipStatus)[keyof typeof SquadMembershipStatus];
/** The order the values are declared in. */
export const SquadMembershipStatusOrder = explicitOrder<SquadMembershipStatus>({
  [SquadMembershipStatus.ACTIVE]: 0,
  [SquadMembershipStatus.INACTIVE]: 1,
});

export const SquadOwnerInvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type SquadOwnerInvitationStatus =
  (typeof SquadOwnerInvitationStatus)[keyof typeof SquadOwnerInvitationStatus];
/** The order the values are declared in. */
export const SquadOwnerInvitationStatusOrder = explicitOrder<SquadOwnerInvitationStatus>({
  [SquadOwnerInvitationStatus.PENDING]: 0,
  [SquadOwnerInvitationStatus.ACCEPTED]: 1,
  [SquadOwnerInvitationStatus.EXPIRED]: 2,
  [SquadOwnerInvitationStatus.REVOKED]: 3,
});

// --- League Invitation ---

export const InviteType = {
  EMAIL: 'EMAIL',
  LINK: 'LINK',
} as const;
export type InviteType = (typeof InviteType)[keyof typeof InviteType];
/** No natural order: A to Z by its display strings. */
export const InviteTypeOrder = alphabeticalOrder('InviteType');

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];
/** The order the values are declared in. */
export const InvitationStatusOrder = explicitOrder<InvitationStatus>({
  [InvitationStatus.PENDING]: 0,
  [InvitationStatus.ACCEPTED]: 1,
  [InvitationStatus.EXPIRED]: 2,
  [InvitationStatus.REVOKED]: 3,
});

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
/** The order the values are declared in. */
export const WeekDayOrder = explicitOrder<WeekDay>({
  [WeekDay.MONDAY]: 0,
  [WeekDay.TUESDAY]: 1,
  [WeekDay.WEDNESDAY]: 2,
  [WeekDay.THURSDAY]: 3,
  [WeekDay.FRIDAY]: 4,
  [WeekDay.SATURDAY]: 5,
  [WeekDay.SUNDAY]: 6,
});

// --- Tier Assignment ---

export const TierAssignmentMode = {
  AUTO_RANKING: 'AUTO_RANKING',
  AUTO_PRICE: 'AUTO_PRICE',
  MANUAL: 'MANUAL',
} as const;
export type TierAssignmentMode = (typeof TierAssignmentMode)[keyof typeof TierAssignmentMode];
/** No natural order: A to Z by its display strings. */
export const TierAssignmentModeOrder = alphabeticalOrder('TierAssignmentMode');

// --- Admin ---

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  SUPPORT: 'SUPPORT',
  DATA_OPS: 'DATA_OPS',
  VIEWER: 'VIEWER',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];
/** The order the values are declared in. */
export const AdminRoleOrder = explicitOrder<AdminRole>({
  [AdminRole.SUPER_ADMIN]: 0,
  [AdminRole.OPERATIONS]: 1,
  [AdminRole.SUPPORT]: 2,
  [AdminRole.DATA_OPS]: 3,
  [AdminRole.VIEWER]: 4,
});

// --- Announcements ---

export const AnnouncementType = {
  BANNER: 'BANNER',
  NOTIFICATION: 'NOTIFICATION',
  BOTH: 'BOTH',
} as const;
export type AnnouncementType = (typeof AnnouncementType)[keyof typeof AnnouncementType];
/** No natural order: A to Z by its display strings. */
export const AnnouncementTypeOrder = alphabeticalOrder('AnnouncementType');

export const AnnouncementTarget = {
  ALL_USERS: 'ALL_USERS',
  ALL_TENANTS: 'ALL_TENANTS',
  SPECIFIC_TENANTS: 'SPECIFIC_TENANTS',
} as const;
export type AnnouncementTarget = (typeof AnnouncementTarget)[keyof typeof AnnouncementTarget];
/** No natural order: A to Z by its display strings. */
export const AnnouncementTargetOrder = alphabeticalOrder('AnnouncementTarget');

export const Severity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  ERROR: 'ERROR',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];
/** Least to most severe. */
export const SeverityOrder = explicitOrder<Severity>({
  [Severity.INFO]: 0,
  [Severity.WARNING]: 1,
  [Severity.ERROR]: 2,
  [Severity.CRITICAL]: 3,
});

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
/** No natural order: A to Z by its display strings. */
export const EmailCategoryOrder = alphabeticalOrder('EmailCategory');

/** The categories a member can turn off, one switch each on their account (#844 slice 5, Q7.1). */
export const OptionalEmailCategory = {
  COMMISSIONER_UPDATES: EmailCategory.COMMISSIONER_UPDATES,
  CONTEST_UPDATES: EmailCategory.CONTEST_UPDATES,
  LIVE_STANDINGS: EmailCategory.LIVE_STANDINGS,
  RESULTS: EmailCategory.RESULTS,
  RECEIPTS: EmailCategory.RECEIPTS,
} as const;
export type OptionalEmailCategory = (typeof OptionalEmailCategory)[keyof typeof OptionalEmailCategory];
/** No natural order: A to Z by its display strings. */
export const OptionalEmailCategoryOrder = alphabeticalOrder('OptionalEmailCategory');

export function isOptionalEmailCategory(category: EmailCategory): category is OptionalEmailCategory {
  return Object.values<EmailCategory>(OptionalEmailCategory).includes(category);
}

/**
 * A league's plan (#943), in order: a feature that starts at Pro is in Pro, Premium and
 * Platinum, and a cap never falls as the plan rises. Every league starts on Premium, a gift until
 * its renewal date (plans/payments.md §3). "Plan" on screen, never "tier": tiers are
 * player tiers in tiered selection. Only the plan entitlements service compares plans
 * (`poolmaster/no-plan-branching`); everything else asks it about a cap or a feature.
 */
export const LeaguePlan = {
  FREE: 'FREE',
  PRO: 'PRO',
  PREMIUM: 'PREMIUM',
  PLATINUM: 'PLATINUM',
} as const;
export type LeaguePlan = (typeof LeaguePlan)[keyof typeof LeaguePlan];
/** The order the values are declared in. */
export const LeaguePlanOrder = explicitOrder<LeaguePlan>({
  [LeaguePlan.FREE]: 0,
  [LeaguePlan.PRO]: 1,
  [LeaguePlan.PREMIUM]: 2,
  [LeaguePlan.PLATINUM]: 3,
});

/** Every plan, lowest first. The order is what "starts at" and "never falls" mean. */
export const LEAGUE_PLANS: readonly LeaguePlan[] = explicitOrderValues(LeaguePlanOrder);

/**
 * What a plan can switch on or off (#944), each with the first plan that gets it in
 * PLAN_CONFIG. One per optional email and one per championship or history view
 * (plans/season-cups.md §7). What every league always has (account, security and membership
 * emails, contest results and places) is not here, because no plan can take it away.
 */
export const PlanFeature = {
  EMAIL_CONTEST_OPENED: 'EMAIL_CONTEST_OPENED',
  EMAIL_CONTEST_ENTRY_COMPLETED: 'EMAIL_CONTEST_ENTRY_COMPLETED',
  EMAIL_CONTEST_RESULTS: 'EMAIL_CONTEST_RESULTS',
  EMAIL_CONTEST_EVENT_CHANGED: 'EMAIL_CONTEST_EVENT_CHANGED',
  EMAIL_CONTEST_STARTED_SUMMARY: 'EMAIL_CONTEST_STARTED_SUMMARY',
  EMAIL_CONTEST_ENTRY_REMINDER: 'EMAIL_CONTEST_ENTRY_REMINDER',
  EMAIL_CONTEST_STANDINGS: 'EMAIL_CONTEST_STANDINGS',
  EMAIL_EVENT_COMING_UP: 'EMAIL_EVENT_COMING_UP',
  EMAIL_EVENT_READY_FOR_CONTESTS: 'EMAIL_EVENT_READY_FOR_CONTESTS',
  EMAIL_CONTEST_NOT_OPEN: 'EMAIL_CONTEST_NOT_OPEN',
  EMAIL_YEAR_IN_REVIEW: 'EMAIL_YEAR_IN_REVIEW',
  EMAIL_LEAGUE_MEMBER_JOINED: 'EMAIL_LEAGUE_MEMBER_JOINED',
  CUP_STANDINGS: 'CUP_STANDINGS',
  CUP_CROWNING: 'CUP_CROWNING',
  CHAMPIONSHIP: 'CHAMPIONSHIP',
  TROPHY_SHELF: 'TROPHY_SHELF',
  CUP_SETTINGS: 'CUP_SETTINGS',
  PAST_YEARS: 'PAST_YEARS',
  ALL_TIME_SUMMARY: 'ALL_TIME_SUMMARY',
  RECORD_BOOK: 'RECORD_BOOK',
} as const;
export type PlanFeature = (typeof PlanFeature)[keyof typeof PlanFeature];
/** No natural order: A to Z by its display strings. */
export const PlanFeatureOrder = alphabeticalOrder('PlanFeature');

/** The groups the Plans page lists features under. */
export const PlanFeatureGroup = {
  EMAILS: 'EMAILS',
  CHAMPIONSHIPS: 'CHAMPIONSHIPS',
  HISTORY: 'HISTORY',
} as const;
export type PlanFeatureGroup = (typeof PlanFeatureGroup)[keyof typeof PlanFeatureGroup];
/** The order the Plans pages list the groups in (#2110): emails first, then championships, then history. */
export const PlanFeatureGroupOrder = explicitOrder<PlanFeatureGroup>({
  [PlanFeatureGroup.EMAILS]: 0,
  [PlanFeatureGroup.CHAMPIONSHIPS]: 1,
  [PlanFeatureGroup.HISTORY]: 2,
});

export const PLAN_FEATURE_GROUP: Readonly<Record<PlanFeature, PlanFeatureGroup>> = {
  EMAIL_CONTEST_OPENED: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_ENTRY_COMPLETED: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_RESULTS: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_EVENT_CHANGED: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_STARTED_SUMMARY: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_ENTRY_REMINDER: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_STANDINGS: PlanFeatureGroup.EMAILS,
  EMAIL_EVENT_COMING_UP: PlanFeatureGroup.EMAILS,
  EMAIL_EVENT_READY_FOR_CONTESTS: PlanFeatureGroup.EMAILS,
  EMAIL_CONTEST_NOT_OPEN: PlanFeatureGroup.EMAILS,
  EMAIL_YEAR_IN_REVIEW: PlanFeatureGroup.EMAILS,
  EMAIL_LEAGUE_MEMBER_JOINED: PlanFeatureGroup.EMAILS,
  CUP_STANDINGS: PlanFeatureGroup.CHAMPIONSHIPS,
  CUP_CROWNING: PlanFeatureGroup.CHAMPIONSHIPS,
  CHAMPIONSHIP: PlanFeatureGroup.CHAMPIONSHIPS,
  TROPHY_SHELF: PlanFeatureGroup.CHAMPIONSHIPS,
  CUP_SETTINGS: PlanFeatureGroup.CHAMPIONSHIPS,
  PAST_YEARS: PlanFeatureGroup.HISTORY,
  ALL_TIME_SUMMARY: PlanFeatureGroup.HISTORY,
  RECORD_BOOK: PlanFeatureGroup.HISTORY,
};

/** Why a league's plan changed (#1032), recorded on each plan change log row. */
export const LeaguePlanChangeReason = {
  /** A commissioner or root admin picked the plan. */
  CHOSEN: 'CHOSEN',
  /** The league's preview period ended, and the sweep moved it to Free. */
  PREVIEW_ENDED: 'PREVIEW_ENDED',
  /** A root admin extended an ended gift, which put back the plan the league had. */
  GIFT_RESTORED: 'GIFT_RESTORED',
} as const;
export type LeaguePlanChangeReason = (typeof LeaguePlanChangeReason)[keyof typeof LeaguePlanChangeReason];
/** No natural order: A to Z by its display strings. */
export const LeaguePlanChangeReasonOrder = alphabeticalOrder('LeaguePlanChangeReason');

/**
 * What one line of a league's payment history records (#980). An expansion while payments are
 * off, and one a root admin gives, are both $0; the paid kinds arrive with checkout (#981).
 */
export const LeaguePaymentKind = {
  CONTEST_EXPANSION_PAYMENTS_OFF: 'CONTEST_EXPANSION_PAYMENTS_OFF',
  CONTEST_EXPANSION_GRANT: 'CONTEST_EXPANSION_GRANT',
} as const;
export type LeaguePaymentKind = (typeof LeaguePaymentKind)[keyof typeof LeaguePaymentKind];
/** No natural order: A to Z by its display strings. */
export const LeaguePaymentKindOrder = alphabeticalOrder('LeaguePaymentKind');

/** The limits a plan sets (#944): entries per contest, and sports leagues per calendar year. */
export const PlanCap = {
  ENTRIES_PER_CONTEST: 'ENTRIES_PER_CONTEST',
  SPORTS_LEAGUES_PER_YEAR: 'SPORTS_LEAGUES_PER_YEAR',
} as const;
export type PlanCap = (typeof PlanCap)[keyof typeof PlanCap];
/** No natural order: A to Z by its display strings. */
export const PlanCapOrder = alphabeticalOrder('PlanCap');

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
  /** An account's email address was changed, to the old address, with a link to undo it (#903). */
  EMAIL_CHANGED: 'EMAIL_CHANGED',
  /** A root admin's test of the email setup, from the Email settings (#910). */
  EMAIL_TEST: 'EMAIL_TEST',
  /** A squad's year in the league, sent by the commissioner after the year ends (#872). */
  YEAR_IN_REVIEW: 'YEAR_IN_REVIEW',
  /** A league's Monday list of the next two weeks' events, for its commissioners (#851). */
  EVENT_WEEKLY_DIGEST: 'EVENT_WEEKLY_DIGEST',
  /** A member joined the league, for its commissioners: at once, or a busy day's rest the next day (#903). */
  LEAGUE_MEMBER_JOINED: 'LEAGUE_MEMBER_JOINED',
  /** A contest was expanded, for the league's other commissioners (#987). */
  CONTEST_EXPANDED: 'CONTEST_EXPANDED',
  /** A league's Premium preview period ends in 30, 7 or 1 days, for its commissioners (#986). */
  LEAGUE_PLAN_PREVIEW_ENDING: 'LEAGUE_PLAN_PREVIEW_ENDING',
  /** A postponement took a live contest back to open before the event's new start, for the league (#1808). */
  CONTEST_REOPENED: 'CONTEST_REOPENED',
} as const;
export type EmailTemplateKey = (typeof EmailTemplateKey)[keyof typeof EmailTemplateKey];
/** No natural order: A to Z by its display strings. */
export const EmailTemplateKeyOrder = alphabeticalOrder('EmailTemplateKey');

/** Who a system email goes to, as the root admin's Notifications page lists it. */
export const EmailAudience = {
  MEMBERS: 'MEMBERS',
  COMMISSIONERS: 'COMMISSIONERS',
  ROOT_ADMINS: 'ROOT_ADMINS',
  PEOPLE_INVITED: 'PEOPLE_INVITED',
  ACCOUNT_HOLDERS: 'ACCOUNT_HOLDERS',
} as const;
export type EmailAudience = (typeof EmailAudience)[keyof typeof EmailAudience];
/** The widest group first, then the people who run leagues and the site. */
export const EmailAudienceOrder = explicitOrder<EmailAudience>({
  [EmailAudience.ACCOUNT_HOLDERS]: 0,
  [EmailAudience.MEMBERS]: 1,
  [EmailAudience.PEOPLE_INVITED]: 2,
  [EmailAudience.COMMISSIONERS]: 3,
  [EmailAudience.ROOT_ADMINS]: 4,
});

/**
 * The emails EMAIL_CONFIG has a switch for. Account emails (the password reset and the
 * password-changed and email-changed notices) have none: switching one off would silently break
 * password recovery or hide a takeover. Nor does the test email: it tests the setup as it stands. They all still
 * obey the overall switch.
 */
export type SwitchableEmailTemplateKey = Exclude<
  EmailTemplateKey,
  | typeof EmailTemplateKey.PASSWORD_RESET
  | typeof EmailTemplateKey.PASSWORD_CHANGED
  | typeof EmailTemplateKey.EMAIL_CHANGED
  | typeof EmailTemplateKey.EMAIL_TEST
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
/** The order the values are declared in. */
export const EmailMessageStatusOrder = explicitOrder<EmailMessageStatus>({
  [EmailMessageStatus.QUEUED]: 0,
  [EmailMessageStatus.SENDING]: 1,
  [EmailMessageStatus.SENT]: 2,
  [EmailMessageStatus.DELIVERED]: 3,
  [EmailMessageStatus.BOUNCED]: 4,
  [EmailMessageStatus.COMPLAINED]: 5,
  [EmailMessageStatus.FAILED]: 6,
  [EmailMessageStatus.SKIPPED]: 7,
});

/**
 * Whether a system email is sent, as the root admin's Notifications page shows it (#1870): ON or
 * OFF by its own switch in EMAIL_CONFIG, or ALWAYS_ON for an email that has no switch (the account
 * emails and the test email), which only the overall switch stops.
 */
export const EmailTemplateStatus = {
  ON: 'ON',
  OFF: 'OFF',
  ALWAYS_ON: 'ALWAYS_ON',
} as const;
export type EmailTemplateStatus = (typeof EmailTemplateStatus)[keyof typeof EmailTemplateStatus];
/** The order the values are declared in. */
export const EmailTemplateStatusOrder = explicitOrder<EmailTemplateStatus>({
  [EmailTemplateStatus.ON]: 0,
  [EmailTemplateStatus.OFF]: 1,
  [EmailTemplateStatus.ALWAYS_ON]: 2,
});

/**
 * One kind of background job (#1439): work a request hands off rather than waits for. Each has
 * one handler and one payload schema, in the background-jobs module's registries.
 */
export const BackgroundJobType = {
  /** Syncs one event's field from its league's provider: queued by the sync tick and by a root admin's Sync now (#2009). */
  SYNC_EVENT_FIELD: 'SYNC_EVENT_FIELD',
  /**
   * Syncs one event's scores from its league's provider: queued by the sync tick while its Games
   * are due or in play, by a provider's webhook (#1498) and by a root admin's Sync now (#2009).
   */
  SYNC_EVENT_SCORES: 'SYNC_EVENT_SCORES',
  /** Queues "Contest is live" (E1) to the league of one contest that just went live for an event (#1387). */
  CONTEST_STARTED_EMAILS: 'CONTEST_STARTED_EMAILS',
  /** Queues "Final results" (F1 to F3) to the league of one contest that just completed (#1387). */
  CONTEST_SETTLED_EMAILS: 'CONTEST_SETTLED_EMAILS',
  /** Queues "Event postponed", "New date" or "Event cancelled" (C6, C7) to the league of one contest on the event (#1458). */
  CONTEST_EVENT_CHANGED_EMAILS: 'CONTEST_EVENT_CHANGED_EMAILS',
  /** Queues "Event postponed, picks are open again" to the league of one contest a postponement took back to open (#1808, #1910). */
  CONTEST_REOPENED_EMAILS: 'CONTEST_REOPENED_EMAILS',
  /** Settles the contests of one event that just completed or was cancelled (#1448). */
  SETTLE_SPORT_EVENT_CONTESTS: 'SETTLE_SPORT_EVENT_CONTESTS',
  /** Settles the squares contests played on one game once the game is decided (#711). */
  SETTLE_GAME_CONTESTS: 'SETTLE_GAME_CONTESTS',
  /** Rebuilds the stored live leaderboards of one event's contests, or of one contest (#1463). */
  REBUILD_LEADERBOARDS: 'REBUILD_LEADERBOARDS',
  /** Syncs one sport league's events from the provider that creates them, for one or more years (#1819). */
  SYNC_LEAGUE_EVENTS: 'SYNC_LEAGUE_EVENTS',
  /** Tries one synced DRAFT event's automatic release: every ready check passing releases it, any failing holds it (#1823). */
  RELEASE_SPORT_EVENT: 'RELEASE_SPORT_EVENT',
  /** Syncs one event's games from its provider after a field sync, then tiers and prices its field (#1952). */
  SYNC_EVENT_GAMES_AND_TIERS: 'SYNC_EVENT_GAMES_AND_TIERS',
  /** Takes one event's contests live at their cutoffs once the event has started (#1952). */
  ACTIVATE_EVENT_CONTESTS: 'ACTIVATE_EVENT_CONTESTS',
  /** A postponed event's contests follow its start: reopened while it is ahead, live once it has passed (#1792, #1952). */
  FOLLOW_POSTPONED_EVENT_CONTESTS: 'FOLLOW_POSTPONED_EVENT_CONTESTS',
  /** Resolves the OPEN unmapped participant findings of feed ids a mapping now names, however it was made (#2069). */
  RESOLVE_MAPPED_PARTICIPANT_FINDINGS: 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS',
  /** Runs the tiebreaker game rule for each slot of one event after a write to its games (#2048). */
  REFRESH_SLOT_TIEBREAKERS: 'REFRESH_SLOT_TIEBREAKERS',
  /** Syncs one sport league's roster for its current Season from its provider: queued by the sync tick (#2025). */
  SYNC_LEAGUE_ROSTER: 'SYNC_LEAGUE_ROSTER',
  /** Recomputes the Season slot status of each slot of one event from its Matches after one of them moved (#2013). */
  REFRESH_SLOT_STATUS: 'REFRESH_SLOT_STATUS',
  /** Recomputes one event's status from its slots after one of them moved (#2013). */
  REFRESH_EVENT_STATUS: 'REFRESH_EVENT_STATUS',
  /** Closes a contest's league championship year once nothing in it is unfinished, after the contest went final (#2021). */
  CLOSE_LEAGUE_CHAMPIONSHIP_YEAR: 'CLOSE_LEAGUE_CHAMPIONSHIP_YEAR',
  /** Closes the championship year of each league with a contest in a Season, after one of its slots moved (#2021). */
  CLOSE_SEASON_CHAMPIONSHIP_YEARS: 'CLOSE_SEASON_CHAMPIONSHIP_YEARS',
} as const;
export type BackgroundJobType = (typeof BackgroundJobType)[keyof typeof BackgroundJobType];
/** No natural order: A to Z by its display strings. */
export const BackgroundJobTypeOrder = alphabeticalOrder('BackgroundJobType');

/**
 * What a background job is about, as Activity groups and filters it (#1819). Derived from the
 * job's type (`BACKGROUND_JOB_KINDS`), never stored.
 */
export const BackgroundJobKind = {
  /** A provider sync: a sport league's events, an event's field or its scores. */
  SYNC: 'SYNC',
  /** Emails queued to a league. */
  EMAIL: 'EMAIL',
  /** Contests settled when their event or game is decided. */
  SETTLEMENT: 'SETTLEMENT',
  /** An event released for contests, and what its release sets off. */
  RELEASE: 'RELEASE',
  /** Anything else, such as a leaderboard rebuild. */
  OTHER: 'OTHER',
} as const;
export type BackgroundJobKind = (typeof BackgroundJobKind)[keyof typeof BackgroundJobKind];
/** The order the values are declared in. */
export const BackgroundJobKindOrder = explicitOrder<BackgroundJobKind>({
  [BackgroundJobKind.SYNC]: 0,
  [BackgroundJobKind.EMAIL]: 1,
  [BackgroundJobKind.SETTLEMENT]: 2,
  [BackgroundJobKind.RELEASE]: 3,
  [BackgroundJobKind.OTHER]: 4,
});

/** Where one background job stands. */
export const BackgroundJobStatus = {
  /** Waiting for its run time, first time or after a failed try. */
  QUEUED: 'QUEUED',
  /** Claimed by a server task until its lease ends; a lease that ends unfinished makes it due again. */
  RUNNING: 'RUNNING',
  /** Its handler finished. */
  SUCCEEDED: 'SUCCEEDED',
  /** Its last try failed, or its payload was invalid; it will not run again. */
  FAILED: 'FAILED',
} as const;
export type BackgroundJobStatus = (typeof BackgroundJobStatus)[keyof typeof BackgroundJobStatus];
/** The order the values are declared in. */
export const BackgroundJobStatusOrder = explicitOrder<BackgroundJobStatus>({
  [BackgroundJobStatus.QUEUED]: 0,
  [BackgroundJobStatus.RUNNING]: 1,
  [BackgroundJobStatus.SUCCEEDED]: 2,
  [BackgroundJobStatus.FAILED]: 3,
});

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
  /** The league's plan lacks the email's plan feature (#948): a higher-plan email is simply not sent. */
  NOT_IN_PLAN: 'NOT_IN_PLAN',
} as const;
export type EmailSkipReason = (typeof EmailSkipReason)[keyof typeof EmailSkipReason];
/** No natural order: A to Z by its display strings. */
export const EmailSkipReasonOrder = alphabeticalOrder('EmailSkipReason');

/** Why an address is on the email suppression list. */
export const EmailSuppressionReason = {
  /** A permanent bounce: the mailbox does not exist or will never accept mail. */
  BOUNCE: 'BOUNCE',
  /** The recipient marked an email as spam. */
  COMPLAINT: 'COMPLAINT',
} as const;
export type EmailSuppressionReason = (typeof EmailSuppressionReason)[keyof typeof EmailSuppressionReason];
/** No natural order: A to Z by its display strings. */
export const EmailSuppressionReasonOrder = alphabeticalOrder('EmailSuppressionReason');

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
/** The order the values are declared in. */
export const CupWeightOrder = explicitOrder<CupWeight>({
  [CupWeight.NORMAL]: 0,
  [CupWeight.BONUS]: 1,
  [CupWeight.DOUBLE]: 2,
  [CupWeight.NOT_COUNTED]: 3,
});

/**
 * How a league's commissioners hear about upcoming events (#851): PER_EVENT, "Coming up soon"
 * and "Ready for contests" for each event; WEEKLY_DIGEST, one Monday email listing the next two
 * weeks' events instead of both.
 */
export const EventEmailDelivery = {
  PER_EVENT: 'PER_EVENT',
  WEEKLY_DIGEST: 'WEEKLY_DIGEST',
} as const;
export type EventEmailDelivery = (typeof EventEmailDelivery)[keyof typeof EventEmailDelivery];
/** No natural order: A to Z by its display strings. */
export const EventEmailDeliveryOrder = alphabeticalOrder('EventEmailDelivery');

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
/** No natural order: A to Z by its display strings. */
export const CupPointsScaleOrder = alphabeticalOrder('CupPointsScale');

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
/** The order the values are declared in. */
export const CupContestCountOrder = explicitOrder<CupContestCount>({
  [CupContestCount.COUNTED]: 0,
  [CupContestCount.NOT_COUNTED]: 1,
  [CupContestCount.NO_RESULT]: 2,
  [CupContestCount.NOT_FINAL]: 3,
  [CupContestCount.AFTER_CROWNING]: 4,
});

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
/** The order the values are declared in. */
export const ContestResultCountOrder = explicitOrder<ContestResultCount>({
  [ContestResultCount.COUNTED]: 0,
  [ContestResultCount.NOT_COUNTED]: 1,
  [ContestResultCount.NO_RESULT]: 2,
});

/**
 * A cup's state (#841): OPEN while its standings are worked out on read; CROWNED once the
 * commissioner crowns it, its standings frozen and its trophies handed out.
 */
export const CupStatus = {
  OPEN: 'OPEN',
  CROWNED: 'CROWNED',
} as const;
export type CupStatus = (typeof CupStatus)[keyof typeof CupStatus];
/** The order the values are declared in. */
export const CupStatusOrder = explicitOrder<CupStatus>({
  [CupStatus.OPEN]: 0,
  [CupStatus.CROWNED]: 1,
});

/** The trophy a squad takes from a crowned cup (#841): 1st, 2nd or 3rd. Squads sharing a place share its trophy. */
export const CupTrophy = {
  CHAMPION: 'CHAMPION',
  RUNNER_UP: 'RUNNER_UP',
  THIRD: 'THIRD',
} as const;
export type CupTrophy = (typeof CupTrophy)[keyof typeof CupTrophy];
/** The order the values are declared in. */
export const CupTrophyOrder = explicitOrder<CupTrophy>({
  [CupTrophy.CHAMPION]: 0,
  [CupTrophy.RUNNER_UP]: 1,
  [CupTrophy.THIRD]: 2,
});

/** Where a league stands on an event in its weekly digest email (#851). */
export const DigestEventState = {
  /** The league already has a contest on it. */
  CONTEST_SET_UP: 'CONTEST_SET_UP',
  /** Released, with no contest yet: the digest links to Create contest. */
  READY: 'READY',
  /** Still a draft, so no contest can be set up on it yet. */
  NOT_READY: 'NOT_READY',
} as const;
export type DigestEventState = (typeof DigestEventState)[keyof typeof DigestEventState];
/** The order the values are declared in. */
export const DigestEventStateOrder = explicitOrder<DigestEventState>({
  [DigestEventState.CONTEST_SET_UP]: 0,
  [DigestEventState.READY]: 1,
  [DigestEventState.NOT_READY]: 2,
});

/**
 * The All years page's tiles (#837): the squads with the most league championships won (years
 * over only) and the most cups won (crowned cups' champions). Ties name every squad.
 */
export const SummaryTile = {
  MOST_CHAMPIONSHIPS: 'MOST_CHAMPIONSHIPS',
  MOST_CUPS: 'MOST_CUPS',
} as const;
export type SummaryTile = (typeof SummaryTile)[keyof typeof SummaryTile];
/** The order the values are declared in. */
export const SummaryTileOrder = explicitOrder<SummaryTile>({
  [SummaryTile.MOST_CHAMPIONSHIPS]: 0,
  [SummaryTile.MOST_CUPS]: 1,
});

/**
 * The league's record book on All years (#873), each worked out on read from its counted
 * contest finishes and championships. A record shows its holders and the next best; ties show
 * every holder.
 */
export const RecordType = {
  /** League championships won, years over only. */
  MOST_CHAMPIONSHIPS: 'MOST_CHAMPIONSHIPS',
  /** The longest run of championships in consecutive years, two or more. */
  BACK_TO_BACK_CHAMPIONS: 'BACK_TO_BACK_CHAMPIONS',
  /** The most contest wins in one year. */
  MOST_WINS_IN_A_YEAR: 'MOST_WINS_IN_A_YEAR',
  /** The most contest wins of all time. */
  MOST_WINS_ALL_TIME: 'MOST_WINS_ALL_TIME',
  /** The most contests in a row on the podium, of the contests a squad placed in, in settlement order. */
  LONGEST_PODIUM_RUN: 'LONGEST_PODIUM_RUN',
  /** A contest win with the most ranked entries. */
  BIGGEST_FIELD_WON: 'BIGGEST_FIELD_WON',
  /** The most years in a row winning the same perpetual trophy (#874's contest run every year), two or more. */
  REPEAT_WINNER: 'REPEAT_WINNER',
  /** Hall of Lame: the most 2nd places. */
  MOST_RUNNER_UPS: 'MOST_RUNNER_UPS',
  /** Hall of Lame: the most 4th places, just off the podium. */
  MOST_FOURTHS: 'MOST_FOURTHS',
  /** Hall of Lame: the most last places among the squads, in contests of three or more squads. */
  MOST_LAST_PLACES: 'MOST_LAST_PLACES',
  /** Hall of Lame: the most contests in a row placed in without a win, past or still running. */
  LONGEST_DROUGHT: 'LONGEST_DROUGHT',
} as const;
export type RecordType = (typeof RecordType)[keyof typeof RecordType];
/** No natural order: A to Z by its display strings. */
export const RecordTypeOrder = alphabeticalOrder('RecordType');

/** The Hall of Lame's records (#873): shown below the record book, and hidden with the league's setting. */
export const HALL_OF_LAME_RECORD_TYPES: readonly RecordType[] = [
  RecordType.MOST_RUNNER_UPS,
  RecordType.MOST_FOURTHS,
  RecordType.MOST_LAST_PLACES,
  RecordType.LONGEST_DROUGHT,
];

export function isHallOfLameRecord(type: RecordType): boolean {
  return HALL_OF_LAME_RECORD_TYPES.includes(type);
}

/**
 * Which trophy a squad page's trophy shelf (#872) shows: a league championship finished 1st to 3rd
 * in a year that is over, or a crowned cup's trophy. Both use `CupTrophy` for the place.
 */
export const TrophyKind = {
  CHAMPIONSHIP: 'CHAMPIONSHIP',
  CUP: 'CUP',
} as const;
export type TrophyKind = (typeof TrophyKind)[keyof typeof TrophyKind];
/** No natural order: A to Z by its display strings. */
export const TrophyKindOrder = alphabeticalOrder('TrophyKind');

/**
 * Where a league's year in review (#872) stands for last year: nothing to send (no championship
 * contest counted that year), ready for the commissioner to send, or sent.
 */
export const YearReviewStatus = {
  NOTHING_TO_SEND: 'NOTHING_TO_SEND',
  READY: 'READY',
  SENT: 'SENT',
} as const;
export type YearReviewStatus = (typeof YearReviewStatus)[keyof typeof YearReviewStatus];
/** The order the values are declared in. */
export const YearReviewStatusOrder = explicitOrder<YearReviewStatus>({
  [YearReviewStatus.NOTHING_TO_SEND]: 0,
  [YearReviewStatus.READY]: 1,
  [YearReviewStatus.SENT]: 2,
});

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
/** The order the values are declared in. */
export const ChampionshipTileOrder = explicitOrder<ChampionshipTile>({
  [ChampionshipTile.MOST_FIRSTS]: 0,
  [ChampionshipTile.MOST_SECONDS]: 1,
  [ChampionshipTile.MOST_THIRDS]: 2,
  [ChampionshipTile.MOST_PODIUMS]: 3,
  [ChampionshipTile.MOST_TOP_TENS]: 4,
  [ChampionshipTile.MOST_PLAYED]: 5,
});

/**
 * A value a field can be put in order by (#1807, #2160): odds to win (shortest first), seed or rank
 * (both lowest first). Each tier and pricing profile lists the ones it orders by, first deciding.
 */
export const FieldOrderBasis = {
  ODDS: 'ODDS',
  SEED: 'SEED',
  RANKING: 'RANKING',
} as const;
export type FieldOrderBasis = (typeof FieldOrderBasis)[keyof typeof FieldOrderBasis];
/** As the profile forms offer them: today's order, odds first. */
export const FieldOrderBasisOrder = explicitOrder<FieldOrderBasis>({
  [FieldOrderBasis.ODDS]: 0,
  [FieldOrderBasis.SEED]: 1,
  [FieldOrderBasis.RANKING]: 2,
});

/**
 * How a tier profile lays a field out in tiers (#2160). EQUAL_GROUPS fills each tier but the last
 * with the same number, in the field's order; RANGES puts each participant in the tier whose range
 * holds their value of the profile's first source (seed 1, seeds 2-4, seed 5 and up).
 */
export const TierProfileType = {
  EQUAL_GROUPS: 'EQUAL_GROUPS',
  RANGES: 'RANGES',
} as const;
export type TierProfileType = (typeof TierProfileType)[keyof typeof TierProfileType];
/** Equal groups first, as the profile form offers them. */
export const TierProfileTypeOrder = explicitOrder<TierProfileType>({
  [TierProfileType.EQUAL_GROUPS]: 0,
  [TierProfileType.RANGES]: 1,
});

/** What a tier profile's last tier takes (#1844). */
export const PlatformTierProfileLastTier = {
  /** Everyone left once the tiers before it are filled. */
  ALL_REMAINING: 'ALL_REMAINING',
  /** At most the profile's `lastTierMax`; anyone beyond is in no tier and can't be picked. */
  CAPPED: 'CAPPED',
} as const;
export type PlatformTierProfileLastTier = (typeof PlatformTierProfileLastTier)[keyof typeof PlatformTierProfileLastTier];
/** Uncapped first, as the profile form offers them. */
export const PlatformTierProfileLastTierOrder = explicitOrder<PlatformTierProfileLastTier>({
  [PlatformTierProfileLastTier.ALL_REMAINING]: 0,
  [PlatformTierProfileLastTier.CAPPED]: 1,
});

/**
 * A player's stat in one Game's box score (#2026, plans/league-model-redesign.md §5): one shared
 * enum across every sport, so a stat row's code is one Postgres enum. Each sport has the codes its
 * composites count (#2027); a provider's adapter names which of its box score fields is which.
 */
export const SportStat = {
  // American football.
  PASSING_TOUCHDOWNS: 'PASSING_TOUCHDOWNS',
  RUSHING_TOUCHDOWNS: 'RUSHING_TOUCHDOWNS',
  RECEIVING_TOUCHDOWNS: 'RECEIVING_TOUCHDOWNS',
  RECEPTIONS: 'RECEPTIONS',
  PASSING_YARDS: 'PASSING_YARDS',
  RUSHING_YARDS: 'RUSHING_YARDS',
  RECEIVING_YARDS: 'RECEIVING_YARDS',
  // Basketball.
  POINTS: 'POINTS',
  REBOUNDS: 'REBOUNDS',
  /** Basketball's, hockey's and soccer's: a pass that set up a score. */
  ASSISTS: 'ASSISTS',
  // Hockey and soccer.
  GOALS: 'GOALS',
  /** Hockey's. */
  SHOTS_ON_GOAL: 'SHOTS_ON_GOAL',
  /** Soccer's. */
  SHOTS_ON_TARGET: 'SHOTS_ON_TARGET',
  // Baseball.
  TOTAL_BASES: 'TOTAL_BASES',
  RUNS: 'RUNS',
  RUNS_BATTED_IN: 'RUNS_BATTED_IN',
  WALKS: 'WALKS',
  STOLEN_BASES: 'STOLEN_BASES',
} as const;
export type SportStat = (typeof SportStat)[keyof typeof SportStat];
/** Grouped by sport, each sport's stats in the order a box score lists them. */
export const SportStatOrder = explicitOrder<SportStat>({
  [SportStat.PASSING_TOUCHDOWNS]: 0,
  [SportStat.RUSHING_TOUCHDOWNS]: 1,
  [SportStat.RECEIVING_TOUCHDOWNS]: 2,
  [SportStat.RECEPTIONS]: 3,
  [SportStat.PASSING_YARDS]: 4,
  [SportStat.RUSHING_YARDS]: 5,
  [SportStat.RECEIVING_YARDS]: 6,
  [SportStat.POINTS]: 7,
  [SportStat.REBOUNDS]: 8,
  [SportStat.ASSISTS]: 9,
  [SportStat.GOALS]: 10,
  [SportStat.SHOTS_ON_GOAL]: 11,
  [SportStat.SHOTS_ON_TARGET]: 12,
  [SportStat.TOTAL_BASES]: 13,
  [SportStat.RUNS]: 14,
  [SportStat.RUNS_BATTED_IN]: 15,
  [SportStat.WALKS]: 16,
  [SportStat.STOLEN_BASES]: 17,
});
