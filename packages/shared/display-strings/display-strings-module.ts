/**
 * The shape every display-string module has (#1956, epic #1955): the words the app shows for a
 * code, one module per language, `en-US.ts` first. Every value of every shared enum and every
 * API error code has an entry, so a module that misses one, or names a value that no longer
 * exists, fails the type check (`rules/ux-rules.md` §16 *Display Strings*).
 */
import type * as Enums from '../domain/enums';
import type { ApiErrorCode } from '../dto/api-error-codes';
import type { Sport } from '../domain/enums';
import type { GenericSportWordRole, SportWordEntryKey } from './sport-word-roles';

/**
 * The words for one key: a plain string, or a name with a shorter form for tight spaces (a grid
 * column, a chip). A lookup that asks for the short form falls back to the name.
 */
export type DisplayEntry = string | { readonly name: string; readonly short: string };

/**
 * Every shared enum in `packages/shared/domain/enums.ts`, by name, with its value type.
 * `rules:check:display-strings` fails when enums.ts declares an enum this list leaves out.
 */
export type SharedEnums = {
  Sport: Enums.Sport;
  ParticipantType: Enums.ParticipantType;
  ParticipantStatus: Enums.ParticipantStatus;
  ProviderHealthStatus: Enums.ProviderHealthStatus;
  ProviderCode: Enums.ProviderCode;
  ProviderWebhookEventSet: Enums.ProviderWebhookEventSet;
  LeaguePhase: Enums.LeaguePhase;
  SlotKind: Enums.SlotKind;
  SeriesFormat: Enums.SeriesFormat;
  SlotPairing: Enums.SlotPairing;
  SeasonSlotStatus: Enums.SeasonSlotStatus;
  SeasonCompetitionStatus: Enums.SeasonCompetitionStatus;
  SlotWindowStatus: Enums.SlotWindowStatus;
  SlotProviderMatchType: Enums.SlotProviderMatchType;
  MatchFormat: Enums.MatchFormat;
  PeriodUnit: Enums.PeriodUnit;
  InjuryStatusCode: Enums.InjuryStatusCode;
  FormTrend: Enums.FormTrend;
  PoolType: Enums.PoolType;
  ContestFormat: Enums.ContestFormat;
  TournamentFormat: Enums.TournamentFormat;
  MatchStatus: Enums.MatchStatus;
  MatchSide: Enums.MatchSide;
  MatchEnding: Enums.MatchEnding;
  MatchSideOutcome: Enums.MatchSideOutcome;
  HomeAway: Enums.HomeAway;
  PeriodKind: Enums.PeriodKind;
  SportLeagueNoun: Enums.SportLeagueNoun;
  RaceResultStatus: Enums.RaceResultStatus;
  RaceResultRowError: Enums.RaceResultRowError;
  RaceResultOrderError: Enums.RaceResultOrderError;
  RaceResultChange: Enums.RaceResultChange;
  GolfRoundScoreChange: Enums.GolfRoundScoreChange;
  SelectionType: Enums.SelectionType;
  TemplateCoverageMode: Enums.TemplateCoverageMode;
  PickEmMode: Enums.PickEmMode;
  PickOutcome: Enums.PickOutcome;
  PredictedResult: Enums.PredictedResult;
  SurvivorWeekOutcome: Enums.SurvivorWeekOutcome;
  SelectionStatus: Enums.SelectionStatus;
  SportEventStatus: Enums.SportEventStatus;
  ContestOpening: Enums.ContestOpening;
  ProviderSyncRunStatus: Enums.ProviderSyncRunStatus;
  ProviderSyncKind: Enums.ProviderSyncKind;
  AutoReleaseCheckOutcome: Enums.AutoReleaseCheckOutcome;
  ReleaseCheckKey: Enums.ReleaseCheckKey;
  SportLeagueSyncHealth: Enums.SportLeagueSyncHealth;
  SportLeagueIssueType: Enums.SportLeagueIssueType;
  ProviderSyncFindingSeverity: Enums.ProviderSyncFindingSeverity;
  ProviderSyncFindingStatus: Enums.ProviderSyncFindingStatus;
  ProviderSyncFindingKind: Enums.ProviderSyncFindingKind;
  ProviderSyncFindingAction: Enums.ProviderSyncFindingAction;
  SportEventReleaseMode: Enums.SportEventReleaseMode;
  SportEventReleaseAtKind: Enums.SportEventReleaseAtKind;
  ParticipantAddedBy: Enums.ParticipantAddedBy;
  SportLeagueSyncMode: Enums.SportLeagueSyncMode;
  SportLeagueIssueTargetType: Enums.SportLeagueIssueTargetType;
  JobTrigger: Enums.JobTrigger;
  JobErrorType: Enums.JobErrorType;
  IngestionJobStatus: Enums.IngestionJobStatus;
  ParticipantRoundStatus: Enums.ParticipantRoundStatus;
  RoundStatus: Enums.RoundStatus;
  MatchResultSource: Enums.MatchResultSource;
  ProviderGameState: Enums.ProviderGameState;
  ParticipantInactiveReason: Enums.ParticipantInactiveReason;
  ParticipantStandingStatus: Enums.ParticipantStandingStatus;
  ContestStatus: Enums.ContestStatus;
  ContestEntryStatus: Enums.ContestEntryStatus;
  LeagueRole: Enums.LeagueRole;
  LeagueMembershipStatus: Enums.LeagueMembershipStatus;
  LeagueIconKey: Enums.LeagueIconKey;
  AuthProvider: Enums.AuthProvider;
  TimeFormat: Enums.TimeFormat;
  ColorScheme: Enums.ColorScheme;
  ValuationSource: Enums.ValuationSource;
  FieldValueSetBy: Enums.FieldValueSetBy;
  GolfCategoryKey: Enums.GolfCategoryKey;
  GolfCutRuleType: Enums.GolfCutRuleType;
  TeamIconKey: Enums.TeamIconKey;
  SquadMembershipStatus: Enums.SquadMembershipStatus;
  SquadOwnerInvitationStatus: Enums.SquadOwnerInvitationStatus;
  InviteType: Enums.InviteType;
  InvitationStatus: Enums.InvitationStatus;
  WeekDay: Enums.WeekDay;
  TierAssignmentMode: Enums.TierAssignmentMode;
  AdminRole: Enums.AdminRole;
  AnnouncementType: Enums.AnnouncementType;
  AnnouncementTarget: Enums.AnnouncementTarget;
  Severity: Enums.Severity;
  EmailCategory: Enums.EmailCategory;
  OptionalEmailCategory: Enums.OptionalEmailCategory;
  LeaguePlan: Enums.LeaguePlan;
  PlanFeature: Enums.PlanFeature;
  PlanFeatureGroup: Enums.PlanFeatureGroup;
  LeaguePlanChangeReason: Enums.LeaguePlanChangeReason;
  LeaguePaymentKind: Enums.LeaguePaymentKind;
  PlanCap: Enums.PlanCap;
  EmailTemplateKey: Enums.EmailTemplateKey;
  EmailAudience: Enums.EmailAudience;
  EmailMessageStatus: Enums.EmailMessageStatus;
  EmailTemplateStatus: Enums.EmailTemplateStatus;
  BackgroundJobType: Enums.BackgroundJobType;
  BackgroundJobKind: Enums.BackgroundJobKind;
  BackgroundJobStatus: Enums.BackgroundJobStatus;
  EmailSkipReason: Enums.EmailSkipReason;
  EmailSuppressionReason: Enums.EmailSuppressionReason;
  CupWeight: Enums.CupWeight;
  EventEmailDelivery: Enums.EventEmailDelivery;
  CupPointsScale: Enums.CupPointsScale;
  CupContestCount: Enums.CupContestCount;
  ContestResultCount: Enums.ContestResultCount;
  CupStatus: Enums.CupStatus;
  CupTrophy: Enums.CupTrophy;
  DigestEventState: Enums.DigestEventState;
  SummaryTile: Enums.SummaryTile;
  RecordType: Enums.RecordType;
  TrophyKind: Enums.TrophyKind;
  YearReviewStatus: Enums.YearReviewStatus;
  PlatformTierProfileLastTier: Enums.PlatformTierProfileLastTier;
  FieldOrderBasis: Enums.FieldOrderBasis;
  TierProfileType: Enums.TierProfileType;
  ChampionshipTile: Enums.ChampionshipTile;
};

/** The name of a shared enum: `'ContestStatus'`. */
export type SharedEnumName = keyof SharedEnums;

/** An entry for every value of every shared enum. */
export type EnumDisplayStrings = { readonly [E in SharedEnumName]: { readonly [V in SharedEnums[E]]: DisplayEntry } };

/** One message for every API error code. */
export type ErrorDisplayStrings = { readonly [C in ApiErrorCode]: string };

/**
 * A screen's own wording for some error codes, keyed by code then context
 * (`errorContext.CONTEST_ENTRY_LOCKED.pickEm`, looked up as `error.CONTEST_ENTRY_LOCKED.pickEm`).
 * A screen names its context; a code it has no wording for reads the code's `error` message.
 */
export type ErrorContextDisplayStrings = {
  readonly [C in ApiErrorCode]?: { readonly [context: string]: string };
};

/**
 * A display-string module. `errorContext` holds a screen's own wording of an error code; `word`
 * holds generic words, with numbers or plurals in them
 * (`weekNumber: 'Week {{n}}'`, `round_one` / `round_other`), and the generic word for every sport
 * word role; `sport` holds the words that differ by sport, keyed by sport code then role
 * (`sport.GOLF.participant_one`), and a role a sport leaves out reads the generic word. Proper
 * names (teams, players, tournaments, named slots) are model columns and never go in a module.
 */
export type DisplayStringsModule = {
  readonly enum: EnumDisplayStrings;
  readonly error: ErrorDisplayStrings;
  readonly errorContext: ErrorContextDisplayStrings;
  readonly word: { readonly [key: string]: DisplayEntry } & { readonly [K in SportWordEntryKey<GenericSportWordRole>]: DisplayEntry };
  readonly sport: { readonly [S in Sport]?: { readonly [K in SportWordEntryKey]?: DisplayEntry } };
};
