/**
 * Enumerations used across the PoolMaster domain.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active backend
 * refactor plans. Some values remain as deferred catalog entries even when
 * they are no longer part of the first-pass runtime surface.
 */

// --- Sports ---

export const Sport = {
  GOLF: 'GOLF',
  NFL: 'NFL',
  NBA: 'NBA',
  F1: 'F1',
  NASCAR: 'NASCAR',
  NCAA_BASKETBALL: 'NCAA_BASKETBALL',
  NCAA_HOCKEY: 'NCAA_HOCKEY',
  NCAA_FOOTBALL: 'NCAA_FOOTBALL',
  TENNIS: 'TENNIS',
  HORSE_RACING: 'HORSE_RACING',
  SOCCER: 'SOCCER',
  NHL: 'NHL',
  MLB: 'MLB',
  UFC: 'UFC',
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

export const ContestType = {
  SINGLE_EVENT: 'SINGLE_EVENT',
  // SEASON_LONG removed — deferred (see plans/deferred/contest-rules-deferred.md)
} as const;
export type ContestType = (typeof ContestType)[keyof typeof ContestType];

/**
 * How participants select their picks for a contest.
 *
 * SNAKE_DRAFT — turn-based exclusive selection; each pick owned by one manager.
 * TIERED — pick N from defined tier groups; non-exclusive.
 * BUDGET_PICK — build a roster within a cost budget; non-exclusive.
 * OPEN_SELECTION — deferred unrestricted selection catalog entry.
 * PICK_EM — deferred outcome prediction catalog entry.
 * BRACKET_PICK_EM — deferred bracket prediction catalog entry.
 */
export const SelectionType = {
  SNAKE_DRAFT: 'SNAKE_DRAFT',
  TIERED: 'TIERED',
  BUDGET_PICK: 'BUDGET_PICK',
  OPEN_SELECTION: 'OPEN_SELECTION',
  PICK_EM: 'PICK_EM',
  BRACKET_PICK_EM: 'BRACKET_PICK_EM',
} as const;
export type SelectionType = (typeof SelectionType)[keyof typeof SelectionType];

/**
 * How scores are calculated.
 *
 * ADVANCEMENT — points from team/player wins and round progression.
 * STAT_ACCUMULATION — points from personal player stats (goals, assists, etc.).
 * STROKE_PLAY — lower total strokes wins (golf).
 * POSITION — points by finish position (horse racing, F1).
 * BRACKET — deferred bracket prediction scoring catalog entry.
 * FIGHT_RESULT — points by win method: KO, submission, decision (UFC).
 * CUMULATIVE — generic point accumulation for deferred or catch-all modes.
 */
export const ScoringEngine = {
  ADVANCEMENT: 'ADVANCEMENT',
  STAT_ACCUMULATION: 'STAT_ACCUMULATION',
  STROKE_PLAY: 'STROKE_PLAY',
  POSITION: 'POSITION',
  BRACKET: 'BRACKET',
  FIGHT_RESULT: 'FIGHT_RESULT',
  CUMULATIVE: 'CUMULATIVE',
} as const;
export type ScoringEngine = (typeof ScoringEngine)[keyof typeof ScoringEngine];

/**
 * Deferred survivor/knockout catalog — how picks would be submitted.
 *
 * LIVE_PICK — one pick per period, submitted before each period begins.
 * LOCKED_PICK — all picks submitted upfront before the event starts.
 */
export const SurvivorStyle = {
  LIVE_PICK: 'LIVE_PICK',
  LOCKED_PICK: 'LOCKED_PICK',
} as const;
export type SurvivorStyle = (typeof SurvivorStyle)[keyof typeof SurvivorStyle];

// --- Draft Session ---

export const DraftMode = {
  LIVE: 'LIVE',
  ASYNC: 'ASYNC',
} as const;
export type DraftMode = (typeof DraftMode)[keyof typeof DraftMode];

export const DraftStatus = {
  PENDING: 'PENDING',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  COMPLETE: 'COMPLETE',
} as const;
export type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus];

// --- Contest Lifecycle ---

export const ContestStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  DRAFTING: 'DRAFTING',
  LOCKED: 'LOCKED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ContestStatus = (typeof ContestStatus)[keyof typeof ContestStatus];

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

export const LeagueVisibility = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
} as const;
export type LeagueVisibility = (typeof LeagueVisibility)[keyof typeof LeagueVisibility];

export const SquadStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type SquadStatus = (typeof SquadStatus)[keyof typeof SquadStatus];

export const SquadMembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type SquadMembershipStatus =
  (typeof SquadMembershipStatus)[keyof typeof SquadMembershipStatus];

// --- Pricing (for Tiered and Budget Pick contests) ---

export const PricingMethod = {
  ODDS: 'ODDS',
  SEED: 'SEED',
  WORLD_RANKING: 'WORLD_RANKING',
  SEASON_STATS: 'SEASON_STATS',
  COMMISSIONER: 'COMMISSIONER',
} as const;
export type PricingMethod = (typeof PricingMethod)[keyof typeof PricingMethod];

export const TierAssignmentMethod = {
  SEED: 'SEED',
  WORLD_RANKING: 'WORLD_RANKING',
  ODDS: 'ODDS',
  CONFERENCE: 'CONFERENCE',
  DIVISION: 'DIVISION',
  POT: 'POT',
  BOUT_POSITION: 'BOUT_POSITION',
  COMMISSIONER: 'COMMISSIONER',
} as const;
export type TierAssignmentMethod = (typeof TierAssignmentMethod)[keyof typeof TierAssignmentMethod];

// --- League Invitation ---

export const InvitePolicy = {
  COMMISSIONER_ONLY: 'COMMISSIONER_ONLY',
  LINK_INVITE: 'LINK_INVITE',
  OPEN: 'OPEN',
} as const;
export type InvitePolicy = (typeof InvitePolicy)[keyof typeof InvitePolicy];

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

// --- Commissioner Permissions ---

export const CommissionerPermission = {
  // League management
  LEAGUE_SETTINGS_EDIT: 'league.settings.edit',
  LEAGUE_MEMBERS_INVITE: 'league.members.invite',
  LEAGUE_MEMBERS_REMOVE: 'league.members.remove',
  LEAGUE_MEMBERS_ROLE_CHANGE: 'league.members.role.change',
  // Contest management
  CONTEST_CREATE: 'contest.create',
  CONTEST_EDIT: 'contest.edit',
  CONTEST_DELETE: 'contest.delete',
  CONTEST_CLOSE: 'contest.close',
  CONTEST_REOPEN: 'contest.reopen',
  // Draft management
  DRAFT_START: 'draft.start',
  DRAFT_PAUSE: 'draft.pause',
  DRAFT_UNDO_PICK: 'draft.undo_pick',
  DRAFT_OVERRIDE_PICK: 'draft.override_pick',
  DRAFT_EXTEND_CLOCK: 'draft.extend_clock',
  // Scoring & results
  SCORING_OVERRIDE: 'scoring.override',
  SCORING_RECALCULATE: 'scoring.recalculate',
  RESULTS_OVERRIDE: 'results.override',
  PAYOUT_CONFIRM: 'payout.confirm',
  PAYOUT_RECALCULATE: 'payout.recalculate',
  // Communication
  ANNOUNCEMENT_POST: 'announcement.post',
  ANNOUNCEMENT_PIN: 'announcement.pin',
  MESSAGE_DELETE: 'message.delete',
  MEMBER_MUTE: 'member.mute',
} as const;
export type CommissionerPermission = (typeof CommissionerPermission)[keyof typeof CommissionerPermission];

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

// --- Notification Delivery ---

export const DeliveryStatus = {
  SENT: 'SENT',
  SUPPRESSED: 'SUPPRESSED',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const NotificationChannel = {
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

// --- Draft ---

export const AutoPickPolicy = {
  QUEUE_THEN_BEST: 'QUEUE_THEN_BEST',
  BEST_AVAILABLE: 'BEST_AVAILABLE',
  RANDOM: 'RANDOM',
} as const;
export type AutoPickPolicy = (typeof AutoPickPolicy)[keyof typeof AutoPickPolicy];

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

export const ActionItemPriority = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type ActionItemPriority = (typeof ActionItemPriority)[keyof typeof ActionItemPriority];

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
