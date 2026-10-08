/**
 * Domain types for the cross-sport catalog and event core (#235): who competes in
 * which sport league, the calendar, and each participant's round-by-round and
 * running state within an event. Each mirrors its `schema.prisma` model; sport
 * particulars live in sport extension rows and are not part of these types.
 */

import type { DomainEntity, Participant } from './types';
import type { ParticipantRoundStatus, ParticipantStandingStatus, ValuationSource } from './enums';

/** A real-world league, tour or conference within a sport — the PGA Tour, the NBA. Never the product's League. */
export interface SportLeague extends DomainEntity {
  sportId: string;
  name: string;
  /** Substring a provider event name carries when it belongs to this sport league. */
  matchKeyword: string | null;
  /**
   * The event year the sport league is currently on. Not a foreign key: setting it
   * refuses a year the sport league has no events in (plans/147 decision 6).
   */
  currentEventYear: number | null;
  isActive: boolean;
}

/**
 * The Participant↔SportLeague edge: a competitor's membership of a sport league and
 * their current rank there. Carries the canonical Participant, as a membership edge
 * carries the canonical User.
 */
export interface ParticipantLeagueAffiliation extends DomainEntity {
  participantId: string;
  sportLeagueId: string;
  /** Current rank in this sport league; 1 is best. */
  ranking: number | null;
  participant: Participant;
}

/** A scheduled sub-period of an event — a golf round, a match day. */
export interface SportEventRound extends DomainEntity {
  sportEventId: string;
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt: Date | null;
}

/** One participant's part in one round. What was scored lives in the sport's extension row. */
export interface SportEventParticipantRound extends DomainEntity {
  sportEventParticipantId: string;
  sportEventRoundId: string;
  roundNumber: number;
  status: ParticipantRoundStatus;
  completedAt: Date | null;
}

/**
 * A participant's running standing within an event. `position` is the cross-sport
 * rank key and is direction-free — 1 is best in every sport. The raw score behind it
 * lives in the sport's extension row, never here.
 */
export interface SportEventParticipantStanding extends DomainEntity {
  sportEventParticipantId: string;
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  asOf: Date | null;
  currentRound: number | null;
}

/**
 * A recurring, named competition within a sport league — "The Masters" — that each
 * year's SportEvent edition resolves to. Found or created by (sportLeagueId, name).
 */
export interface EventSeries extends DomainEntity {
  sportLeagueId: string;
  name: string;
  /** False retires the series; its past editions are untouched. */
  isActive: boolean;
}

/** A pick tier an event's field is divided into. Cross-sport: nothing here is golf. */
export interface SportEventTier extends DomainEntity {
  sportEventId: string;
  tierKey: string;
  label: string;
  tierNumber: number;
  defaultPickCount: number;
}

/**
 * A participant's tier placement and price at one event. Tier and price are set
 * independently — either may be null — and each records how it was set.
 */
export interface SportEventParticipantValuation extends DomainEntity {
  sportEventParticipantId: string;
  sportEventTierId: string | null;
  tierOrderIndex: number | null;
  tierAssignedSource: ValuationSource | null;
  price: number | null;
  priceAssignedSource: ValuationSource | null;
}

// --- Golf extension rows (#236) ---------------------------------------------
// Keyed 1:1 to their core row. The score lives here, never on the core.

/** What one golfer scored in one round. Extends a SportEventParticipantRound. */
export interface SportEventParticipantGolfRound extends DomainEntity {
  participantRoundId: string;
  strokes: number;
  scoreToPar: number;
  thru: number | null;
}

/** The running event totals one golfer's standing was ranked from. Extends a SportEventParticipantStanding. */
export interface SportEventParticipantGolfStanding extends DomainEntity {
  standingId: string;
  eventScoreToPar: number;
  eventStrokes: number;
  currentRoundThru: number | null;
}

/** A core round row with its golf extension — the unit a golf score write produces. */
export interface GolfRoundResult {
  participantRound: SportEventParticipantRound;
  golf: SportEventParticipantGolfRound;
}

/** A core standing row with its golf extension. */
export interface GolfStandingResult {
  standing: SportEventParticipantStanding;
  golf: SportEventParticipantGolfStanding;
}
