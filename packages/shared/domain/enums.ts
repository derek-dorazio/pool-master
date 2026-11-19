/**
 * Enumerations used across the PoolMaster domain.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active backend
 * refactor plans. Some values remain as deferred catalog entries even when
 * they are no longer part of the first-pass runtime surface.
 */

import { alphabeticalOrder, explicitOrder, explicitOrderValues, type EnumOrder } from './enum-order';

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
/** The most popular first, the ancillary sports (cycling, running) last, wherever sports are listed, grids included. */
export const SportOrder = explicitOrder<Sport>({
  [Sport.AMERICAN_FOOTBALL]: 0,
  [Sport.BASKETBALL]: 1,
  [Sport.BASEBALL]: 2,
  [Sport.HOCKEY]: 3,
  [Sport.SOCCER]: 4,
  [Sport.GOLF]: 5,
  [Sport.AUTO_RACING]: 6,
  [Sport.TENNIS]: 7,
  [Sport.HORSE_RACING]: 8,
  [Sport.CYCLING]: 9,
  [Sport.RUNNING]: 10,
});

export const ParticipantType = {
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
} as const;
export type ParticipantType = (typeof ParticipantType)[keyof typeof ParticipantType];
/** No natural order: A to Z by the label each screen shows. */
export const ParticipantTypeOrder: EnumOrder<ParticipantType> = alphabeticalOrder();

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

export const MappingConfidence = {
  EXACT: 'EXACT',
  HIGH: 'HIGH',
  MANUAL: 'MANUAL',
} as const;
export type MappingConfidence = (typeof MappingConfidence)[keyof typeof MappingConfidence];
/** The order the values are declared in. */
export const MappingConfidenceOrder = explicitOrder<MappingConfidence>({
  [MappingConfidence.EXACT]: 0,
  [MappingConfidence.HIGH]: 1,
  [MappingConfidence.MANUAL]: 2,
});

// --- Contest Pool ---

export const PoolType = {
  EVENT_FIELD: 'EVENT_FIELD',
  CUSTOM: 'CUSTOM',
  RANKING_CUTOFF: 'RANKING_CUTOFF',
  FULL_SPORT: 'FULL_SPORT',
} as const;
export type PoolType = (typeof PoolType)[keyof typeof PoolType];
/** No natural order: A to Z by the label each screen shows. */
export const PoolTypeOrder: EnumOrder<PoolType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const ContestFormatOrder: EnumOrder<ContestFormat> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const TournamentFormatOrder: EnumOrder<TournamentFormat> = alphabeticalOrder();

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
 * One side of a match (#698). On a neutral site HOME is the upper line of the bracket; screens
 * say "vs" there and "@" otherwise.
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
/** No natural order: A to Z by the label each screen shows. */
export const BracketAdvancementOrder: EnumOrder<BracketAdvancement> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const MatchPeriodLayoutOrder: EnumOrder<MatchPeriodLayout> = alphabeticalOrder();

/**
 * What screens call a sport league when its sport's noun does not fit (#834): the NCAA Division I
 * tennis championships are leagues, where the ATP and the WTA are tours. A sport league with
 * none set takes its sport's (`SportVocabulary.sportLeague`); read through `sportLeagueNounOf`.
 */
export const SportLeagueNoun = {
  LEAGUE: 'LEAGUE',
} as const;
export type SportLeagueNoun = (typeof SportLeagueNoun)[keyof typeof SportLeagueNoun];
/** No natural order: A to Z by the label each screen shows. */
export const SportLeagueNounOrder: EnumOrder<SportLeagueNoun> = alphabeticalOrder();

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
/** The order the values are declared in. */
export const RaceResultStatusOrder = explicitOrder<RaceResultStatus>({
  [RaceResultStatus.FINISHED]: 0,
  [RaceResultStatus.DID_NOT_FINISH]: 1,
  [RaceResultStatus.DISQUALIFIED]: 2,
  [RaceResultStatus.DID_NOT_START]: 3,
});

/** Why one row of a race's finishing order cannot be applied (#622). */
export const RaceResultRowError = {
  DUPLICATE_PARTICIPANT: 'DUPLICATE_PARTICIPANT',
  POSITION_WITHOUT_FINISH: 'POSITION_WITHOUT_FINISH',
  FINISH_WITHOUT_POSITION: 'FINISH_WITHOUT_POSITION',
} as const;
export type RaceResultRowError = (typeof RaceResultRowError)[keyof typeof RaceResultRowError];
/** No natural order: A to Z by the label each screen shows. */
export const RaceResultRowErrorOrder: EnumOrder<RaceResultRowError> = alphabeticalOrder();

/** Why a race's finishing order as a whole cannot be applied (#622). */
export const RaceResultOrderError = {
  POSITIONS_INVALID: 'POSITIONS_INVALID',
  FIELD_INCOMPLETE: 'FIELD_INCOMPLETE',
} as const;
export type RaceResultOrderError = (typeof RaceResultOrderError)[keyof typeof RaceResultOrderError];
/** No natural order: A to Z by the label each screen shows. */
export const RaceResultOrderErrorOrder: EnumOrder<RaceResultOrderError> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const SelectionTypeOrder: EnumOrder<SelectionType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const ContestTemplateEventTypeOrder: EnumOrder<ContestTemplateEventType> = alphabeticalOrder();

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

/**
 * The statuses an event can still take a contest in: released and not yet started (or moved), or a
 * knockout under way for a second-chance bracket or a squares game to come. A finished or called
 * off event never can. Contest setup lists events in these statuses, and they bound what a
 * caller other than a root admin may list (#1348).
 */
export const OFFERABLE_SPORT_EVENT_STATUSES: readonly SportEventStatus[] = [
  SportEventStatus.SCHEDULED,
  SportEventStatus.POSTPONED,
  SportEventStatus.IN_PROGRESS,
];

/**
 * Whether provider sync may touch a SportEvent — separate from providerId/externalId
 * identity. NONE: unlinked, nothing syncs. SCORES_ONLY: linked to a provider event, so live
 * scores and its field reach it. On a synced sport league the provider also owns its name, venue
 * and dates, never its status, which the lifecycle scheduler moves (ADR 0011).
 */
export const SportEventSyncScope = {
  NONE: 'NONE',
  SCORES_ONLY: 'SCORES_ONLY',
} as const;
export type SportEventSyncScope = (typeof SportEventSyncScope)[keyof typeof SportEventSyncScope];
/** The order the values are declared in. */
export const SportEventSyncScopeOrder = explicitOrder<SportEventSyncScope>({
  [SportEventSyncScope.NONE]: 0,
  [SportEventSyncScope.SCORES_ONLY]: 1,
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
} as const;
export type ProviderSyncKind = (typeof ProviderSyncKind)[keyof typeof ProviderSyncKind];
/** The order the values are declared in. */
export const ProviderSyncKindOrder = explicitOrder<ProviderSyncKind>({
  [ProviderSyncKind.EVENTS]: 0,
  [ProviderSyncKind.FIELD]: 1,
  [ProviderSyncKind.SCORES]: 2,
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

/** What a sport league is, on the root admin's Sports page (#1847). */
export const SportLeagueKind = {
  /** A real league, tour or championship whose events are synced from a provider. */
  REAL: 'REAL',
  /** A Clutch Card's stat pool league: its events are rounds of its parent league's season event (#1820). */
  CLUTCH_CARD: 'CLUTCH_CARD',
} as const;
export type SportLeagueKind = (typeof SportLeagueKind)[keyof typeof SportLeagueKind];
/** The order the values are declared in. */
export const SportLeagueKindOrder = explicitOrder<SportLeagueKind>({
  [SportLeagueKind.REAL]: 0,
  [SportLeagueKind.CLUTCH_CARD]: 1,
});

/**
 * A sport league's sync health on the root admin's Sports page (#1847), from the latest finished
 * run of each of its syncs: its event list (a Clutch Card's parent's), and its events' fields and
 * scores.
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
  /** A sync whose latest finished run failed. */
  SYNC: 'SYNC',
  /** A draft event whose latest automatic release check held it. */
  RELEASE: 'RELEASE',
  /**
   * An event still not completed or cancelled well after its last round or match should have
   * ended (#1865): its results are missing.
   */
  OVERDUE: 'OVERDUE',
} as const;
export type SportLeagueIssueType = (typeof SportLeagueIssueType)[keyof typeof SportLeagueIssueType];
/** The fixed order the chips show in (#1847, #1865). */
export const SportLeagueIssueTypeOrder = explicitOrder<SportLeagueIssueType>({
  [SportLeagueIssueType.SYNC]: 0,
  [SportLeagueIssueType.RELEASE]: 1,
  [SportLeagueIssueType.OVERDUE]: 2,
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
/** No natural order: A to Z by the label each screen shows. */
export const ParticipantAddedByOrder: EnumOrder<ParticipantAddedBy> = alphabeticalOrder();

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

/** What started a provider sync run (#1819). Each kind has all three. */
export const ProviderSyncTrigger = {
  /** The sync's own timer. */
  SCHEDULE: 'SCHEDULE',
  /** The provider's webhook said something changed. */
  WEBHOOK: 'WEBHOOK',
  /** A root admin pressed Sync now. */
  ADMIN: 'ADMIN',
} as const;
export type ProviderSyncTrigger = (typeof ProviderSyncTrigger)[keyof typeof ProviderSyncTrigger];
/** No natural order: A to Z by the label each screen shows. */
export const ProviderSyncTriggerOrder: EnumOrder<ProviderSyncTrigger> = alphabeticalOrder();

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
/** The order the values are declared in. */
export const ParticipantRoundStatusOrder = explicitOrder<ParticipantRoundStatus>({
  [ParticipantRoundStatus.IN_PROGRESS]: 0,
  [ParticipantRoundStatus.COMPLETED]: 1,
  [ParticipantRoundStatus.DNF]: 2,
  [ParticipantRoundStatus.DSQ]: 3,
  [ParticipantRoundStatus.MISSED_CUT]: 4,
});

/**
 * Who set a match's result (#1496, #1531): an admin, or the provider its game is linked to. A
 * provider's later final never overwrites an admin's result; the sync logs the disagreement.
 */
export const MatchResultSource = {
  ADMIN: 'ADMIN',
  PROVIDER: 'PROVIDER',
} as const;
export type MatchResultSource = (typeof MatchResultSource)[keyof typeof MatchResultSource];
/** No natural order: A to Z by the label each screen shows. */
export const MatchResultSourceOrder: EnumOrder<MatchResultSource> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const ParticipantInactiveReasonOrder: EnumOrder<ParticipantInactiveReason> = alphabeticalOrder();

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
/** The order the values are declared in. */
export const ParticipantStandingStatusOrder = explicitOrder<ParticipantStandingStatus>({
  [ParticipantStandingStatus.ACTIVE]: 0,
  [ParticipantStandingStatus.IN_PROGRESS]: 1,
  [ParticipantStandingStatus.COMPLETE]: 2,
  [ParticipantStandingStatus.WITHDRAWN]: 3,
  [ParticipantStandingStatus.ELIMINATED]: 4,
});

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
/** The order the values are declared in. */
export const ContestStatusOrder = explicitOrder<ContestStatus>({
  [ContestStatus.DRAFT]: 0,
  [ContestStatus.OPEN]: 1,
  [ContestStatus.ACTIVE]: 2,
  [ContestStatus.COMPLETED]: 3,
});
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

/** How a prize definition's payout is expressed. */
export const PrizePayoutType = {
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  PERCENTAGE: 'PERCENTAGE',
} as const;
export type PrizePayoutType = (typeof PrizePayoutType)[keyof typeof PrizePayoutType];
/** No natural order: A to Z by the label each screen shows. */
export const PrizePayoutTypeOrder: EnumOrder<PrizePayoutType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const LeagueIconKeyOrder: EnumOrder<LeagueIconKey> = alphabeticalOrder();

export const AuthProvider = {
  EMAIL: 'email',
  GOOGLE: 'google',
  APPLE: 'apple',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];
/** No natural order: A to Z by the label each screen shows. */
export const AuthProviderOrder: EnumOrder<AuthProvider> = alphabeticalOrder();

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
 * How a SportEventParticipantValuation's tier/price was set. See plans/124 §4.5. An automatic one
 * names the value that decided the field's order (#1807, `orderField`): odds, seed, rank, or,
 * with none of them in the field, the name.
 */
export const ValuationSource = {
  AUTO_ODDS: 'AUTO_ODDS',
  AUTO_SEED: 'AUTO_SEED',
  AUTO_RANKING: 'AUTO_RANKING',
  AUTO_NAME: 'AUTO_NAME',
  MANUAL: 'MANUAL',
} as const;
export type ValuationSource = (typeof ValuationSource)[keyof typeof ValuationSource];
/** The order the values are declared in. */
export const ValuationSourceOrder = explicitOrder<ValuationSource>({
  [ValuationSource.AUTO_ODDS]: 0,
  [ValuationSource.AUTO_SEED]: 1,
  [ValuationSource.AUTO_RANKING]: 2,
  [ValuationSource.AUTO_NAME]: 3,
  [ValuationSource.MANUAL]: 4,
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
/** No natural order: A to Z by the label each screen shows. */
export const GolfCategoryKeyOrder: EnumOrder<GolfCategoryKey> = alphabeticalOrder();

export const GolfCutRuleType = {
  FIXED_SCORE: 'FIXED_SCORE',
} as const;
export type GolfCutRuleType =
  (typeof GolfCutRuleType)[keyof typeof GolfCutRuleType];
/** No natural order: A to Z by the label each screen shows. */
export const GolfCutRuleTypeOrder: EnumOrder<GolfCutRuleType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const TeamIconKeyOrder: EnumOrder<TeamIconKey> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const InviteTypeOrder: EnumOrder<InviteType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const TierAssignmentModeOrder: EnumOrder<TierAssignmentMode> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const AnnouncementTypeOrder: EnumOrder<AnnouncementType> = alphabeticalOrder();

export const AnnouncementTarget = {
  ALL_USERS: 'ALL_USERS',
  ALL_TENANTS: 'ALL_TENANTS',
  SPECIFIC_TENANTS: 'SPECIFIC_TENANTS',
} as const;
export type AnnouncementTarget = (typeof AnnouncementTarget)[keyof typeof AnnouncementTarget];
/** No natural order: A to Z by the label each screen shows. */
export const AnnouncementTargetOrder: EnumOrder<AnnouncementTarget> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const EmailCategoryOrder: EnumOrder<EmailCategory> = alphabeticalOrder();

/** The categories a member can turn off, one switch each on their account (#844 slice 5, Q7.1). */
export const OptionalEmailCategory = {
  COMMISSIONER_UPDATES: EmailCategory.COMMISSIONER_UPDATES,
  CONTEST_UPDATES: EmailCategory.CONTEST_UPDATES,
  LIVE_STANDINGS: EmailCategory.LIVE_STANDINGS,
  RESULTS: EmailCategory.RESULTS,
  RECEIPTS: EmailCategory.RECEIPTS,
} as const;
export type OptionalEmailCategory = (typeof OptionalEmailCategory)[keyof typeof OptionalEmailCategory];
/** No natural order: A to Z by the label each screen shows. */
export const OptionalEmailCategoryOrder: EnumOrder<OptionalEmailCategory> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const PlanFeatureOrder: EnumOrder<PlanFeature> = alphabeticalOrder();

/** The groups the Plans page lists features under. */
export const PlanFeatureGroup = {
  EMAILS: 'EMAILS',
  CHAMPIONSHIPS: 'CHAMPIONSHIPS',
  HISTORY: 'HISTORY',
} as const;
export type PlanFeatureGroup = (typeof PlanFeatureGroup)[keyof typeof PlanFeatureGroup];
/** No natural order: A to Z by the label each screen shows. */
export const PlanFeatureGroupOrder: EnumOrder<PlanFeatureGroup> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const LeaguePlanChangeReasonOrder: EnumOrder<LeaguePlanChangeReason> = alphabeticalOrder();

/**
 * What one line of a league's payment history records (#980). An expansion while payments are
 * off, and one a root admin gives, are both $0; the paid kinds arrive with checkout (#981).
 */
export const LeaguePaymentKind = {
  CONTEST_EXPANSION_PAYMENTS_OFF: 'CONTEST_EXPANSION_PAYMENTS_OFF',
  CONTEST_EXPANSION_GRANT: 'CONTEST_EXPANSION_GRANT',
} as const;
export type LeaguePaymentKind = (typeof LeaguePaymentKind)[keyof typeof LeaguePaymentKind];
/** No natural order: A to Z by the label each screen shows. */
export const LeaguePaymentKindOrder: EnumOrder<LeaguePaymentKind> = alphabeticalOrder();

/** The limits a plan sets (#944): entries per contest, and sports leagues per calendar year. */
export const PlanCap = {
  ENTRIES_PER_CONTEST: 'ENTRIES_PER_CONTEST',
  SPORTS_LEAGUES_PER_YEAR: 'SPORTS_LEAGUES_PER_YEAR',
} as const;
export type PlanCap = (typeof PlanCap)[keyof typeof PlanCap];
/** No natural order: A to Z by the label each screen shows. */
export const PlanCapOrder: EnumOrder<PlanCap> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const EmailTemplateKeyOrder: EnumOrder<EmailTemplateKey> = alphabeticalOrder();

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
 * One kind of background job (#1439): work a request hands off rather than waits for. Each has
 * one handler and one payload schema, in the background-jobs module's registries.
 */
export const BackgroundJobType = {
  /** Runs a root admin's submitted sync of one event's feeds (#1441). */
  MANUAL_EVENT_SYNC: 'MANUAL_EVENT_SYNC',
  /** Syncs one linked event's live scores because its provider said something happened in it (#1498). */
  PROVIDER_EVENT_SYNC: 'PROVIDER_EVENT_SYNC',
  /** Queues "Contest is live" (E1) to the league of one contest that just went live for an event (#1387). */
  CONTEST_STARTED_EMAILS: 'CONTEST_STARTED_EMAILS',
  /** Queues "Final results" (F1 to F3) to the league of one contest that just completed (#1387). */
  CONTEST_SETTLED_EMAILS: 'CONTEST_SETTLED_EMAILS',
  /** Queues "Event postponed", "New date" or "Event cancelled" (C6, C7) to the league of one contest on the event (#1458). */
  CONTEST_EVENT_CHANGED_EMAILS: 'CONTEST_EVENT_CHANGED_EMAILS',
  /** Queues "Picks are open again" to the league of one contest a postponement took back to open (#1808). */
  CONTEST_REOPENED_EMAILS: 'CONTEST_REOPENED_EMAILS',
  /** Settles the contests of one event that just completed or was cancelled (#1448). */
  SETTLE_SPORT_EVENT_CONTESTS: 'SETTLE_SPORT_EVENT_CONTESTS',
  /** Settles the squares contests played on one game once the game is decided (#711). */
  SETTLE_GAME_CONTESTS: 'SETTLE_GAME_CONTESTS',
  /** Rebuilds the stored live leaderboards of one event's contests, or of one contest (#1463). */
  REBUILD_LEADERBOARDS: 'REBUILD_LEADERBOARDS',
  /** Adds a released edition to one contest made from a template covering its series, a majors pool's major (#1318). */
  ADD_RELEASED_EDITION_TO_CONTEST: 'ADD_RELEASED_EDITION_TO_CONTEST',
  /** Syncs one sport league's events from the provider that creates them, for one or more years (#1819). */
  SYNC_LEAGUE_EVENTS: 'SYNC_LEAGUE_EVENTS',
  /** Tries one synced DRAFT event's automatic release: every ready check passing releases it, any failing holds it (#1823). */
  RELEASE_SPORT_EVENT: 'RELEASE_SPORT_EVENT',
} as const;
export type BackgroundJobType = (typeof BackgroundJobType)[keyof typeof BackgroundJobType];
/** No natural order: A to Z by the label each screen shows. */
export const BackgroundJobTypeOrder: EnumOrder<BackgroundJobType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const EmailSkipReasonOrder: EnumOrder<EmailSkipReason> = alphabeticalOrder();

/** Why an address is on the email suppression list. */
export const EmailSuppressionReason = {
  /** A permanent bounce: the mailbox does not exist or will never accept mail. */
  BOUNCE: 'BOUNCE',
  /** The recipient marked an email as spam. */
  COMPLAINT: 'COMPLAINT',
} as const;
export type EmailSuppressionReason = (typeof EmailSuppressionReason)[keyof typeof EmailSuppressionReason];
/** No natural order: A to Z by the label each screen shows. */
export const EmailSuppressionReasonOrder: EnumOrder<EmailSuppressionReason> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const EventEmailDeliveryOrder: EnumOrder<EventEmailDelivery> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const CupPointsScaleOrder: EnumOrder<CupPointsScale> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const RecordTypeOrder: EnumOrder<RecordType> = alphabeticalOrder();

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
/** No natural order: A to Z by the label each screen shows. */
export const TrophyKindOrder: EnumOrder<TrophyKind> = alphabeticalOrder();

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

/** What a tier profile's last tier takes (#1844). */
export const TierProfileLastTier = {
  /** Everyone left once the tiers before it are filled. */
  ALL_REMAINING: 'ALL_REMAINING',
  /** At most the profile's `lastTierMax`; anyone beyond is in no tier and can't be picked. */
  CAPPED: 'CAPPED',
} as const;
export type TierProfileLastTier = (typeof TierProfileLastTier)[keyof typeof TierProfileLastTier];
/** Uncapped first, as the profile form offers them. */
export const TierProfileLastTierOrder = explicitOrder<TierProfileLastTier>({
  [TierProfileLastTier.ALL_REMAINING]: 0,
  [TierProfileLastTier.CAPPED]: 1,
});
