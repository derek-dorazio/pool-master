/**
 * Domain types — TypeScript interfaces for the full PoolMaster domain model.
 *
 * Aligned to poolmaster-contest-structures-v4.md and the active refactor plans.
 * The current backend is centered on roster-based contests and core league/
 * contest operations; deferred mechanics remain in the shared type catalog
 * until they are rebuilt or removed.
 */

import type { CupPointsTable } from './cup-points';
import type { PredictedChoice } from './predicted-choice';
import type {
  AuthProvider,
  ContestEntryStatus,
  ContestStatus,
  ContestFormat,
  CupPointsScale,
  CupStatus,
  CupTrophy,
  CupWeight,
  EmailMessageStatus,
  EmailSkipReason,
  EmailSuppressionReason,
  EmailTemplateKey,
  EventEmailDelivery,
  InjuryStatusCode,
  InvitationStatus,
  InviteType,
  LeagueIconKey,
  LeaguePlan,
  LeagueMembershipStatus,
  LeagueRole,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  JobTrigger,
  ParticipantStatus,
  ParticipantType,
  SeasonSlotStatus,
  SelectionType,
  SlotKind,
  Sport,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
  TierAssignmentMode,
  TimeFormat,
  ColorScheme,
} from './enums';

// --- Base ---

export interface DomainEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Identity ---

/** Core user-account record used across PoolMaster services. */
export interface User extends DomainEntity {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  authProvider?: AuthProvider;
  authId?: string;
  isRootAdmin?: boolean;
  timezone?: string;
  locale?: string;
  timeFormat?: TimeFormat;
  colorScheme?: ColorScheme;
}

// --- League ---

/** Core league record that powers league-home, invites, and commissioner management. */
export interface League extends DomainEntity {
  leagueCode: string;
  name: string;
  /** `null` in an update clears it; `undefined` leaves it unchanged. */
  description?: string | null;
  isActive: boolean;
  iconKey: LeagueIconKey;
  /** The league championship's name (#863), shown after its year: "2026 Derek's Pool Cup". */
  cupName: string;
  /** The points table every cup and the championship score on (#841). STANDARD at creation. */
  cupPointsScale: CupPointsScale;
  /** CUSTOM's points for 1st, 2nd ...; empty for every other scale (a database check holds it). */
  cupCustomPoints: number[];
  /** Whether the record book shows its Hall of Lame rows (#873). On at creation. */
  hallOfLameVisible: boolean;
  /** What the league may do (#943): ask the plan entitlements service, never compare plans. PREMIUM at creation. */
  plan: LeaguePlan;
  /** When the league's gifted plan ends (#986, plans/payments.md §3): six months after signup at creation. */
  planRenewsAt: Date;
  /**
   * Sport leagues whose upcoming events the league's commissioners are not emailed about (#851):
   * "Coming up soon" and "Ready for contests". Empty at creation: every sport league.
   */
  mutedSportLeagueIds: string[];
  /** How the commissioners hear about upcoming events (#851): one email per event, or a weekly digest. PER_EVENT at creation. */
  eventEmailDelivery: EventEmailDelivery;
}

/** User membership within a league. */
export interface LeagueMembership extends DomainEntity {
  leagueId: string;
  userId: string;
  role: LeagueRole;
  status: LeagueMembershipStatus;
  joinedAt: Date;
}

/** Team-like grouping owned inside a league for contests that need squad context. */
export interface Squad extends DomainEntity {
  leagueId: string;
  createdBy: string;
  name: string;
  iconKey: TeamIconKey;
  isActive: boolean;
}

/** User membership within a squad. */
export interface SquadMembership extends DomainEntity {
  squadId: string;
  leagueId: string;
  userId: string;
  status: SquadMembershipStatus;
  joinedAt: Date;
}

/** Email-driven invitation to add or replace a team owner inside a league. */
export interface SquadOwnerInvitation extends DomainEntity {
  leagueId: string;
  squadId: string;
  email: string;
  inviteCode: string;
  status: SquadOwnerInvitationStatus;
  invitedBy: string;
  expiresAt?: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
  replacementForUserId?: string;
}

/** Direct email or link-based invitation into a league. */
export interface LeagueInvitation extends DomainEntity {
  leagueId: string;
  email?: string;
  inviteCode: string;
  inviteType: InviteType;
  status: InvitationStatus;
  maxUses: number;
  currentUses: number;
  invitedBy: string;
  expiresAt?: Date;
  acceptedAt?: Date;
  acceptedBy?: string;
}

/**
 * One system email to one person, in the outbox (#844): queued, then sent by the sender, or
 * skipped with the reason. Its content is rendered when it is queued, so what is sent is what was
 * stored; the bodies are cleared after 7 days and the row is deleted after 30.
 */
export interface EmailMessage extends DomainEntity {
  templateKey: EmailTemplateKey;
  /** The user it goes to; absent for an address with no account yet (an invite). */
  recipientUserId?: string;
  recipientEmail: string;
  leagueId?: string;
  contestId?: string;
  entryId?: string;
  invitationId?: string;
  /** Template, what the email is about, and the recipient: one email per key, ever. */
  idempotencyKey: string;
  /** The subject a sweep asks "already told?" about (#1169); unset on an email no sweep checks for. */
  noticeAbout?: string;
  fromName: string;
  fromAddress: string;
  /** Absent on a skipped email and once the bodies are cleared. */
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  /** The one-click unsubscribe URL, sent as List-Unsubscribe, on an email a member can turn off. */
  listUnsubscribeUrl?: string;
  status: EmailMessageStatus;
  /** Set exactly when the status is SKIPPED. */
  skipReason?: EmailSkipReason;
  /** Tries so far, the current one included. */
  attempts: number;
  /** When a queued email is due, or when a sender's claim on it lapses. */
  nextAttemptAt?: Date;
  lastError?: string;
  /** The transport's id for the sent email; SES's id matches its delivery events. */
  providerMessageId?: string;
  sentAt?: Date;
}

/** An address the app no longer emails: it bounced for good or its owner marked an email as spam. */
export interface EmailSuppression extends DomainEntity {
  /** Lower-cased. */
  email: string;
  suppressionReason: EmailSuppressionReason;
  /** The email whose bounce or complaint put the address here, while that row exists. */
  emailMessageId?: string;
}

// --- Sport & Participant ---

/**
 * The reference row for a built sport (#603). `sport` is the sport itself; what a screen calls it
 * comes from code, not from this row. Who competes and how it is scored are each sport league's (#2001).
 */
export interface SportConfig extends DomainEntity {
  sport: Sport;
  /** Its name in addresses (#2042): `football`. Stored, never built from the code. */
  urlSegment: string;
  /** Where it sits wherever sports are listed together, the most popular first; lower first. */
  displayOrder: number;
}


/** Normalized participant record imported from one or more data providers. */
export interface Participant extends DomainEntity {
  /** The one sport league the participant competes in (#1853); the sport is the league's. */
  sportLeagueId: string;
  /** Current rank in the sport league; 1 is best. Null when unranked. */
  ranking: number | null;
  name: string;
  participantType: ParticipantType;

  // Enriched profile fields
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  /** A team's abbreviation as its feed sends it (KC); a player's team and position are their roster row's (#2025). */
  abbreviation?: string;
  status: ParticipantStatus;
  injuryStatus: InjuryStatus;
  photoUrl?: string;
  photoLastUpdated?: Date;
  /**
   * A test participant (QA only, #2096), made for a test slot's field: it joins only a test slot's
   * field, never gets a provider mapping, and no roster or sync reads it.
   */
  isTestData: boolean;
}

/** Injury or availability status captured for a participant. */
export interface InjuryStatus {
  status: InjuryStatusCode;
  detail?: string;
  expectedReturn?: Date;
  updatedAt?: Date;
  source?: string;
}

/**
 * A provider's id for a participant (#2040): the only place a participant's feed id is kept. Unique
 * per provider, sport league and kind of participant, so `externalId` is the provider's raw id.
 */
export interface ParticipantProviderMapping extends DomainEntity {
  participantId: string;
  /** The participant's sport league: a feed id names one participant per sport league (#1853). */
  sportLeagueId: string;
  /** The participant's kind: a team id and a player id the feed numbers alike never collide. */
  participantType: ParticipantType;
  /** The Provider row's id. */
  providerId: string;
  /** That Provider's name, read with the mapping. */
  providerName: string;
  /** The provider's own id for the participant, never prefixed. */
  externalId: string;
  mappedAt: Date;
}

// --- Contest ---

/** Core contest record representing a pool or competition within a league. */
/** The Game a squares contest is played on (#2050), with its match. */
export interface ContestSquaresGame {
  sportEventRoundMatchGameId: string;
  sportEventRoundMatchId: string;
}

export interface Contest extends DomainEntity {
  leagueId: string;
  /**
   * The events of the slots the contest covers (#2014), each once, by start date. One for a golf
   * or race contest, several for a pick'em season.
   */
  sportEventIds: string[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  sport?: Sport;
  /** The URL segment of that sport, read with it (#2042). */
  sportUrlSegment?: string;

  // Timing
  /**
   * When the commissioner opened the contest to the league (#845). Absent for a draft, and for a
   * contest opened before this was kept.
   */
  openedAt?: Date;
  startsAt?: Date;
  endsAt?: Date;
  /**
   * When a random-draw contest's draw dealt its picks (#601). Set only by the draw; from then
   * on the contest takes no entry changes and its picks are public.
   */
  drawnAt?: Date;
  /**
   * A squares contest's one Game (#711, #2050), in a covered slot, and the match it is a Game
   * of: its kickoff closes the contest. Absent for every other contest. The squares digits' draw
   * sets `drawnAt` too.
   */
  squaresGame?: ContestSquaresGame;
  /**
   * The definitions of the slots the contest covers (#2014), one per covered Season slot, in play
   * order: what knockout round values, bracket games and coverage checks read.
   */
  coveredSlotDefinitionIds: string[];
  /** The Season slots themselves, in the same order: a contest's coverage, written once at creation. */
  coveredSeasonSlotIds: string[];
  /** The same Season slots with what a screen shows of each (#2014): its event, kind, status and competition. */
  coveredSlots: ContestCoveredSlot[];
  /** The Season the contest plays in (#2014), fixed at creation: every covered slot is one of its. */
  sportLeagueSeasonId: string;
  /**
   * That Season's championship year (#2021), copied onto the contest at creation and held to the
   * Season by a composite key: the year its cup, championship and history count it in.
   */
  championshipYear: number;
  /** How much the contest counts toward its cup and the league championship (#841). */
  cupWeight: CupWeight;
}

/**
 * One Season slot a contest covers (#2014), with what a screen names and orders it by. Its status
 * is the Season slot's own; its event is the event that plays it, absent until one does.
 */
export interface ContestCoveredSlot {
  seasonSlotId: string;
  slotDefinitionId: string;
  /** The definition's code in its league, such as WEEK_14 or FINAL; nothing parses it. */
  key: string;
  /** The league's proper name for the slot, or a test slot's label; null when the kind names it. */
  name: string | null;
  slotKind: SlotKind;
  /** For a WEEK slot, its week. */
  weekNumber: number | null;
  status: SeasonSlotStatus;
  /** The earliest start of the slot's Games; null until the sync places one (a playoff round before the one ahead of it is played). */
  startsAt: Date | null;
  endsAt: Date | null;
  /** A test slot (QA only): the sync never schedules it, so its event's start stands for its own. */
  isTestData: boolean;
  sportEventId: string | null;
  /** The competition the slot is in, such as REGULAR or CFP, and its name when it has one. */
  competitionCode: string;
  competitionName: string | null;
}

/**
 * One sports league's season-long points race in a league (#841): the 2026 PGA Tour Cup. Made
 * with the league's first contest of the season and sports league, never deleted; while OPEN its
 * standings are worked out from its contests' frozen places.
 */
export interface Cup {
  id: string;
  leagueId: string;
  seasonYear: number;
  sportLeagueId: string;
  status: CupStatus;
  /** When the commissioner crowned it; null while OPEN. */
  crownedAt: Date | null;
  /** The league's points table as it stood at crowning, which a crowned cup keeps scoring on; null while OPEN. */
  crownedPointsTable: CupPointsTable | null;
  createdAt: Date;
}

/** One squad's frozen place in a crowned cup (#841), written once at crowning. */
export interface CupStanding {
  cupId: string;
  squadId: string;
  position: number;
  displayPosition: string;
  /** Tenths of a point. */
  points: number;
  wins: number;
  podiums: number;
  contestsCounted: number;
  /** Its trophy for 1st, 2nd or 3rd; null below the podium or at 0 points. */
  trophy: CupTrophy | null;
}

/**
 * One squad's finish in one settled contest, for the league championship (#863), written once at
 * settlement. `year` is the calendar year the contest went final in, US Eastern.
 */
export interface LeagueYearFinish {
  leagueId: string;
  year: number;
  squadId: string;
  contestId: string;
  /** The squad's best entry's place, 1 best. */
  place: number;
  /** Entries sharing the place, the squad's own included. */
  tiedCount: number;
  rankedEntryCount: number;
  weight: CupWeight;
  /** Tenths of a point. */
  points: number;
  settledAt: Date;
}

/** A league's year in review (#872 slice 4): its commissioner sent it, once per league and year. */
export interface LeagueYearReview {
  leagueId: string;
  /** The championship year reviewed (#2021): a year its Seasons and contests have closed. */
  championshipYear: number;
  /** Null once the account that sent it is gone. */
  sentByUserId: string | null;
  sentAt: Date;
}

/** Tier definition used for tiered contest-selection modes. */
export interface TierDefinition {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  rankingRange?: [number, number];
  priceRange?: [number, number];
  maxParticipants?: number;
  participantIds: string[];
}

// --- Pricing & Tier Configuration ---

/** Tier assignment configuration for contests that use tier-based selection. */
export interface TierConfig {
  contestId: string;
  sport: Sport;
  assignmentMode: TierAssignmentMode;
  tiers: TierDefinition[];
}

// --- Entry & Picks ---

/**
 * An entry in a contest — one per league member per contest.
 * For roster-based contests, this owns the selected roster.
 */
export interface ContestEntry extends DomainEntity {
  contestId: string;
  squadId: string;
  entryNumber: number;
  name: string;
  tiebreakerValue?: number | null;
  /** The entry's status for each event of its contest (#713), in no particular order. */
  events: ContestEntryEventStatus[];
}

/**
 * An entry's draft/submitted status for one event of its contest (#713, design Q5.4): "submit
 * week 6", "submit your Masters picks". Only an event the entry submitted counts for it.
 */
export interface ContestEntryEventStatus {
  sportEventId: string;
  status: ContestEntryStatus;
  /** When the event's picks were last submitted; absent while a draft. */
  submittedAt?: Date;
  /**
   * A prediction contest's tiebreaker for the event (#717): the guessed total points of its
   * tiebreaker game. Absent until given, and in a roster contest, whose tiebreaker is the entry's.
   */
  tiebreakerValue?: number;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface ContestEntryPick extends DomainEntity {
  entryId: string;
  sportEventParticipantId: string;
  tier?: string;
  cost?: number;
  isAutoPicked: boolean;
  lineupSlot?: number;
  pickSequence?: number;
  pickedAt: Date;
}

/**
 * A prediction contest entry's pick of one game (#716): the team it says wins, or a tie (#792),
 * and in a confidence pool the value it gives that pick. One per entry per game.
 */
export type ContestEntryMatchPrediction = DomainEntity & PredictedChoice & {
  contestEntryId: string;
  sportEventRoundMatchId: string;
  /** Null in a straight-up pool, and in a confidence pool until the entry gives one. */
  confidence: number | null;
  pickedAt: Date;
};

// --- Payout Configuration ---

export interface PayoutConfig {
  entryFee?: number;
  prizePool?: number;
  payoutStructure: PayoutSlot[];
  intermediatePrizes: IntermediatePrize[];
}

/** Single payout slot for final standings. */
export interface PayoutSlot {
  rank: number;
  percentage: number;
  fixedAmount?: number;
}

/** Intermediate prize configured outside the final standings table. */
export interface IntermediatePrize {
  name: string;
  description?: string;
  amount?: number;
  percentage?: number;
}

// --- Platform & Ingestion ---

/** What a sync run did, as its columns hold it (#1999): its summary line, counts and errors. */
export interface ProviderSyncRunOutcome {
  /** One line for the sync history: what it did, or why it failed. */
  summary: string;
  /** Its numeric counts by name, for the root admin's diagnostics. */
  stats: Record<string, number>;
  /** The rows it created or updated; null until it completes, or when it counted none. */
  changedCount: number | null;
  /** The errors it hit; a FAILED run has at least one. */
  errorCount: number;
}

/**
 * One feed's sync against a provider — the ingestion history, with its outcome in columns
 * (#1999). Its detailed diagnostics are read one run at a time, as a
 * `ProviderSyncRunWithDetails`. A problem the sync found is a sync finding, not part of the run.
 */
export interface ProviderSyncRun {
  id: string;
  /** The Provider row the run read (#2040). */
  providerId: string;
  /** That Provider's name, read with the run. */
  providerName: string;
  /** Its sport league's sport, read through the league (#2042); null for a run with no sport league. */
  sport: Sport | null;
  /**
   * The provider's id for the run's event, read through `sportEventId` (#2040): null for a
   * whole-sport run, and for a run of a provider event linked to no event of ours.
   */
  eventId: string | null;
  /** What the run syncs and what started it (#1819). */
  kind: ProviderSyncKind;
  trigger: JobTrigger;
  /** The sport league of an EVENTS run, or of a FIELD or SCORES run's event, where known. */
  sportLeagueId: string | null;
  /** The event of a FIELD or SCORES run, in PoolMaster's own ids, where known. */
  sportEventId: string | null;
  /** The background job that ran it; null for a run no job ran. */
  backgroundJobId: string | null;
  status: ProviderSyncRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  summary: string;
  stats: Record<string, number>;
  changedCount: number | null;
  errorCount: number;
}

/**
 * One sync run with its detailed diagnostics: the changed rows, the ingestion job record, and
 * the raw provider payload. `details` is null before the run starts and once the nightly
 * cleanup has cleared it, 30 days after submission.
 */
export interface ProviderSyncRunWithDetails extends ProviderSyncRun {
  details: Record<string, unknown> | null;
}

/** A runtime-tunable platform setting, stored as one JSON document per key. */
export interface PlatformRuntimeConfig extends DomainEntity {
  configKey: string;
  configJson: unknown;
  updatedById: string | null;
}

/** One saved change to a platform setting (#450). Append-only. */
export interface PlatformRuntimeConfigChange {
  id: string;
  configKey: string;
  /** Null when the save created the setting's first stored value. */
  previousJson: unknown;
  newJson: unknown;
  changedById: string | null;
  changedAt: Date;
}

