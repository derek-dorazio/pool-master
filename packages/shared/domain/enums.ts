/**
 * Enumerations used across the PoolMaster domain.
 *
 * Aligned to poolmaster-contest-structures-v4.md — the source of truth
 * for all supported contest types and mechanics.
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

// --- Contest Structure ---

export const ContestType = {
  SINGLE_EVENT: 'SINGLE_EVENT',
  SEASON_LONG: 'SEASON_LONG',
} as const;
export type ContestType = (typeof ContestType)[keyof typeof ContestType];

/**
 * How participants select their picks for a contest.
 *
 * SNAKE_DRAFT — turn-based exclusive selection; each pick owned by one manager.
 * TIERED — pick N from defined tier groups; non-exclusive.
 * BUDGET_PICK — build a roster within a cost budget; non-exclusive.
 * OPEN_SELECTION — pick N from unrestricted field (e.g. NCAA "Pick 8").
 * PICK_EM — predict outcomes (winners, scores); no squad to build.
 * BRACKET_PICK_EM — predict bracket progression; single submission.
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
 * BRACKET — points for correct bracket predictions.
 * FIGHT_RESULT — points by win method: KO, submission, decision (UFC).
 * CUMULATIVE — generic point accumulation (pick'em correct picks, etc.).
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
 * For survivor/knockout contests — how picks are submitted.
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
  OWNER: 'OWNER',
  COMMISSIONER: 'COMMISSIONER',
  MANAGER: 'MANAGER',
  VIEWER: 'VIEWER',
} as const;
export type LeagueRole = (typeof LeagueRole)[keyof typeof LeagueRole];

export const LeagueVisibility = {
  PRIVATE: 'PRIVATE',
  PUBLIC: 'PUBLIC',
} as const;
export type LeagueVisibility = (typeof LeagueVisibility)[keyof typeof LeagueVisibility];

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
  // Templates
  TEMPLATE_CREATE: 'template.create',
  TEMPLATE_SHARE: 'template.share',
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
