/**
 * Domain types — TypeScript interfaces for the full PoolMaster domain model.
 *
 * Aligned to poolmaster-contest-structures-v4.md.
 * Three contest categories: squad selection pools, survivor/knockout pools, pick'em/bracket.
 * No roster management, waivers, trades, or DFS mechanics.
 */

import type {
  ContestStatus,
  ContestType,
  DraftMode,
  DraftStatus,
  LeagueRole,
  LeagueVisibility,
  ParticipantType,
  PricingMethod,
  ScoringEngine,
  SelectionType,
  Sport,
  SurvivorStyle,
  TierAssignmentMethod,
} from './enums';

// --- Base ---

export interface DomainEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Tenant & Identity ---

export interface Tenant extends DomainEntity {
  name: string;
  slug: string;
  planTier: string;
  settings: Record<string, unknown>;
}

export interface User extends DomainEntity {
  email: string;
  displayName: string;
  authProvider?: string;
  authId?: string;
  tenantId?: string;
}

// --- League ---

export interface League extends DomainEntity {
  tenantId: string;
  name: string;
  description?: string;
  createdBy: string;
  visibility: LeagueVisibility;
  maxMembers: number;
  settings: Record<string, unknown>;
}

export interface LeagueMembership extends DomainEntity {
  leagueId: string;
  userId: string;
  role: LeagueRole;
  joinedAt: Date;
}

// --- Sport & Participant ---

export interface SportConfig extends DomainEntity {
  name: Sport;
  participantType: ParticipantType;
  statSchema: Record<string, unknown>;
}

export interface Season extends DomainEntity {
  sportId: string;
  tenantId: string;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

export interface Participant extends DomainEntity {
  sportId: string;
  name: string;
  participantType: ParticipantType;
  externalId?: string;
  metadata: Record<string, unknown>;
}

// --- Contest ---

export interface Contest extends DomainEntity {
  leagueId: string;
  seasonId: string;
  name: string;
  status: ContestStatus;
  contestType: ContestType;
  selectionType: SelectionType;
  scoringEngine: ScoringEngine;
  isExclusive: boolean;

  // Timing
  startsAt?: Date;
  endsAt?: Date;
  lockAt?: Date;

  // Scoring behaviour
  scoringStopsOnElimination: boolean;
  scoringRules: ScoringRulesConfig;

  // Links
  selectionConfigId?: string;
}

/**
 * Structured scoring configuration — stored as JSONB per contest.
 * Only the fields relevant to the contest's scoringEngine are populated.
 */
export interface ScoringRulesConfig {
  // Advancement scoring (team wins / series wins)
  roundValues?: number[];                      // [1, 2, 4, 8] — multiplier per playoff round

  // Stat accumulation scoring (player personal stats)
  statWeights?: Record<string, number>;        // { goal: 6, assist: 3, cleanSheet: 4 }

  // Stroke play (golf)
  missedCutPenalty?: number;                   // e.g. 80 per missed round
  bestBallN?: number;                          // pick 6, use best 4

  // Position scoring (horse racing)
  positionPoints?: Record<number, number>;     // { 1: 100, 2: 60, 3: 40 }

  // Bracket / pick'em
  roundMultipliers?: number[];                 // points per correct pick per round
  seriesLengthBonus?: number;                  // bonus for predicting series length
  correctScoreBonus?: number;                  // bonus for exact score prediction
  groupStagePredictions?: boolean;             // soccer: includes group stage W/D/L

  // Fight result (UFC)
  resultWeights?: Record<string, number>;      // { ko_tko: 10, submission: 9, decision: 7 }
  bonusWeights?: Record<string, number>;       // { round1_finish: 2, round1_ko: 3 }

  // Confidence weighting (optional for pick'em)
  confidenceWeighted?: boolean;

  // Tiebreaker
  tiebreakerRule?: string;
}

// --- Selection Configuration ---

/**
 * How participants make their picks for a contest.
 * Replaces the old DraftConfiguration — covers drafts, tiered picks, budget picks,
 * survivor picks, and bracket predictions.
 */
export interface SelectionConfig extends DomainEntity {
  contestId: string;
  selectionType: SelectionType;

  // --- Snake Draft config ---
  draftMode?: DraftMode;
  rounds?: number;
  timePerPickSeconds?: number;
  autoPickPolicy?: string;

  // --- Tiered Pick config ---
  tierConfig?: TierDefinition[];
  tierAssignmentMethod?: TierAssignmentMethod;

  // --- Budget Pick config ---
  budget?: number;
  pricingMethod?: PricingMethod;
  rosterSize?: number;

  // --- Open Selection config ---
  pickCount?: number;                          // "Pick 8" — how many from the full field

  // --- Survivor config ---
  survivorStyle?: SurvivorStyle;
  picksPerPeriod?: number;                     // typically 1; 2 = Double Pick
  oneEntityPerSeason?: boolean;                // each team/player usable only once
  strikesBeforeElimination?: number;            // 0 = instant elimination
  buybacksAllowed?: boolean;

  // --- Bracket / Pick'em config ---
  roundValues?: number[];                      // bracket: points per correct pick per round
  startRound?: string;                         // e.g. "SWEET_16", "QUARTERFINALS"

  // --- Shared ---
  isExclusive: boolean;
  bestBallN?: number;                          // golf: use best N of submitted picks
  missedCutPenalty?: number;
  captainSlot?: boolean;                       // optional 2x multiplier on one pick
  captainMultiplier?: number;
}

export interface TierDefinition {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
  participantIds: string[];
}

// --- Contest Participant Pool ---

export interface ContestParticipantPool extends DomainEntity {
  contestId: string;
  participantId: string;
  cost?: number;
  tier?: string;
  tierAssignmentMethod?: TierAssignmentMethod;
  isAvailable: boolean;
}

// --- Entry & Picks ---

/**
 * An entry in a contest — one per league member per contest.
 * For squad contests, this owns the drafted/picked roster.
 * For survivor/pick'em, this owns the submitted picks.
 */
export interface ContestEntry extends DomainEntity {
  contestId: string;
  leagueMembershipId: string;
  name: string;
  totalScore: number;
  rank?: number;
  isEliminated: boolean;
}

/**
 * A single pick within an entry's roster (for squad selection contests).
 * Created during a snake draft, tiered pick, or budget pick.
 */
export interface RosterPick extends DomainEntity {
  entryId: string;
  participantId: string;
  draftRound?: number;
  draftPickNumber?: number;
  pickedAt: Date;
  autoPicked: boolean;
}

/**
 * A single pick within a survivor or pick'em contest.
 * One per entry per period (week, round, day).
 */
export interface ContestPick extends DomainEntity {
  entryId: string;
  contestId: string;
  participantId: string;
  period: number;
  periodLabel?: string;                        // "Week 5", "Round 2", "Quarterfinals"
  pickedAt: Date;
  isCorrect?: boolean;                         // resolved after period ends
  confidenceWeight?: number;                   // for confidence-weighted pick'em
  multiplier?: number;                         // for multiplier survivor (NCAAF-5)
  isReplacement?: boolean;                     // for buyback/hold'em replacement picks
}

/**
 * A bracket prediction — all round predictions submitted at once.
 */
export interface BracketPrediction extends DomainEntity {
  entryId: string;
  contestId: string;
  predictions: BracketMatchPrediction[];
  submittedAt: Date;
  tiebreakerValue?: number;                    // e.g. predicted total score of final
}

export interface BracketMatchPrediction {
  roundNumber: number;
  matchNumber: number;
  predictedWinnerId: string;
  predictedSeriesLength?: number;              // for NHL/NBA series
  predictedScore?: string;                     // for soccer exact score
  isCorrect?: boolean;
}

// --- Draft Session (Snake Draft only) ---

export interface DraftSession extends DomainEntity {
  contestId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentEntryId?: string;
  startedAt?: Date;
  pickDeadline?: Date;
}

export interface DraftPick extends DomainEntity {
  draftSessionId: string;
  entryId: string;
  participantId: string;
  pickNumber: number;
  round: number;
  pickInRound: number;
  pickedAt: Date;
  autoPicked: boolean;
}

// --- Standings & Results ---

export interface ContestStanding extends DomainEntity {
  contestId: string;
  entryId: string;
  rank: number;
  totalScore: number;
  lastUpdatedAt: Date;
}

export interface ContestResult extends DomainEntity {
  contestId: string;
  entryId: string;
  finalRank: number;
  totalScore: number;
  prizeAmount?: number;
}
