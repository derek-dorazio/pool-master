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
  DateFormat,
  EmailMessageStatus,
  EmailSkipReason,
  EmailSuppressionReason,
  EmailTemplateKey,
  InjuryStatusCode,
  InvitationStatus,
  InviteType,
  LeagueIconKey,
  LeagueMembershipStatus,
  LeagueRole,
  MappingConfidence,
  ProviderSyncRunStatus,
  ParticipantStatus,
  ParticipantType,
  SelectionType,
  Sport,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
  TierAssignmentMode,
  TimeFormat,
  TournamentFormat,
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
  dateFormat?: DateFormat;
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
  /**
   * Sport leagues whose upcoming events the league's commissioners are not emailed about (#851):
   * "Coming up soon" and "Ready for contests". Empty at creation: every sport league.
   */
  mutedSportLeagueIds: string[];
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
 * stored; the bodies are cleared after 30 days and the row stays.
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
 * comes from code, not from this row. `tournamentFormat` drives the validity matrix.
 */
export interface SportConfig extends DomainEntity {
  sport: Sport;
  participantType: ParticipantType;
  tournamentFormat: TournamentFormat;
}


/** Normalized participant record imported from one or more data providers. */
export interface Participant extends DomainEntity {
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId?: string;

  // Enriched profile fields
  firstName?: string;
  lastName?: string;
  shortName?: string;
  nationality?: string;
  /** Playing role ("GOLFER", "QB"), not a rank — `position` means rank on the standing tables. */
  role?: string;
  teamAffiliation?: string;
  status: ParticipantStatus;
  injuryStatus: InjuryStatus;
  photoUrl?: string;
  photoLastUpdated?: Date;
  externalIds: Record<string, string>;
}

/** Injury or availability status captured for a participant. */
export interface InjuryStatus {
  status: InjuryStatusCode;
  detail?: string;
  expectedReturn?: Date;
  updatedAt?: Date;
  source?: string;
}

/** Mapping between a provider participant and an internal participant. */
export interface ParticipantProviderMapping extends DomainEntity {
  participantId: string;
  providerId: string;
  externalId: string;
  confidence: MappingConfidence;
  mappedAt: Date;
}

// --- Contest ---

/** Core contest record representing a pool or competition within a league. */
export interface Contest extends DomainEntity {
  leagueId: string;
  /**
   * The events the contest covers, in sequence order: by start date (#713). One for a golf or
   * race contest, several for a majors pool or a pick'em season. Every contest has at least one.
   */
  sportEventIds: string[];
  name: string;
  status: ContestStatus;
  contestFormat: ContestFormat;
  selectionType: SelectionType;
  sport?: Sport;

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
   * A squares contest's one game (#711), a match of its event: its kickoff closes the contest.
   * Absent for every other contest. The squares digits' draw sets `drawnAt` too.
   */
  squaresGameMatchId?: string;
  /** The season whose cup the contest counts toward (#841): its first event's year when created. */
  seasonYear: number;
  /** How much the contest counts toward its cup and the league championship (#841). */
  cupWeight: CupWeight;
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
  /** The series of a single-event contest (the Masters); null for a contest of several events. */
  eventSeriesId: string | null;
  selectionType: SelectionType;
  weight: CupWeight;
  /** Tenths of a point. */
  points: number;
  settledAt: Date;
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
  contestFormat: ContestFormat;
  period?: number;
  slot?: number;
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
  sportEventMatchId: string;
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

/**
 * One feed's sync against a provider — the ingestion history. `eventId` is the provider's
 * event identifier when the run was narrowed to one event, null for a whole-sport run.
 * `payload` is the ledger's record of the run: request, provider operation, stats,
 * outcome, and the serialized ingestion job once it completes.
 */
export interface ProviderSyncRun {
  id: string;
  providerId: string;
  sport: Sport;
  eventId: string | null;
  status: ProviderSyncRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  payload: Record<string, unknown>;
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

