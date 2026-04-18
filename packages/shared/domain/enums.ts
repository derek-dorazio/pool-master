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

export const SquadStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type SquadStatus = (typeof SquadStatus)[keyof typeof SquadStatus];

export const GolfContestConfigMode = {
  GOLF_TIERED: 'GOLF_TIERED',
  GOLF_CATEGORY_PICKS: 'GOLF_CATEGORY_PICKS',
} as const;
export type GolfContestConfigMode =
  (typeof GolfContestConfigMode)[keyof typeof GolfContestConfigMode];

export const GolfTierSource = {
  ODDS: 'ODDS',
  WORLD_RANK: 'WORLD_RANK',
} as const;
export type GolfTierSource = (typeof GolfTierSource)[keyof typeof GolfTierSource];

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

export const GolfPlayoffHandling = {
  EXCLUDE_PLAYOFF_HOLES: 'EXCLUDE_PLAYOFF_HOLES',
} as const;
export type GolfPlayoffHandling =
  (typeof GolfPlayoffHandling)[keyof typeof GolfPlayoffHandling];

export const GolfDisplayScoring = {
  TO_PAR: 'TO_PAR',
} as const;
export type GolfDisplayScoring =
  (typeof GolfDisplayScoring)[keyof typeof GolfDisplayScoring];

export const GolfTiebreakerType = {
  PREDICT_WINNING_SCORE: 'PREDICT_WINNING_SCORE',
} as const;
export type GolfTiebreakerType =
  (typeof GolfTiebreakerType)[keyof typeof GolfTiebreakerType];

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

export const JoinPolicy = {
  COMMISSIONER_ONLY: 'COMMISSIONER_ONLY',
  LINK_INVITE: 'LINK_INVITE',
  OPEN: 'OPEN',
} as const;
export type JoinPolicy = (typeof JoinPolicy)[keyof typeof JoinPolicy];

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
