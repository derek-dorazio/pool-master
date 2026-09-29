/**
 * Domain types for the cross-sport catalog and event core (#235): who competes in
 * which sport league, the calendar, and each participant's round-by-round and
 * running state within an event. Each mirrors its `schema.prisma` model; sport
 * particulars live in sport extension rows and are not part of these types.
 */

import type { DomainEntity, Participant } from './types';
import type { ParticipantStandingStatus } from './enums';

/** A real-world league, tour or conference within a sport — the PGA Tour, the NBA. Never the product's League. */
export interface SportLeague extends DomainEntity {
  sportId: string;
  name: string;
  /** Substring a provider event name carries when it belongs to this sport league. */
  matchKeyword: string | null;
  currentSeasonId: string | null;
  isActive: boolean;
}

/** A sport league's calendar year. A grouping of events, not a roster boundary. */
export interface Season extends DomainEntity {
  sportLeagueId: string;
  name: string;
  year: number;
  startDate: Date;
  endDate: Date;
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
  status: string;
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
