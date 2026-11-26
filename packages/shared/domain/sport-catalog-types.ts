/**
 * Domain types for the cross-sport catalog and event core (#235): who competes in
 * which sport league, the calendar, and each participant's round-by-round and
 * running state within an event. Each mirrors its `schema.prisma` model; sport
 * particulars live in sport extension rows and are not part of these types.
 */

import type { ScoringFamily } from './sports/scoring-family';
import type { ProviderCode, MatchEnding, MatchPeriodLayout, MatchResultSource, MatchSide, MatchStatus, ParticipantRoundStatus, ParticipantType, ParticipantStandingStatus, RaceResultStatus, SlotKind, SlotPairing, SportLeagueNoun, ValuationSource } from './enums';
import type { DomainEntity } from './types';

/**
 * A sport league's link to one provider's league (#1997), with the names the screens show. A
 * league may be mapped to more than one provider; its `selectedProviderMapping` is the one synced.
 */
export interface SportLeagueProviderMapping {
  id: string;
  providerLeagueId: string;
  /** The provider's own code for its league (`nfl`). */
  providerLeagueCode: string;
  providerLeagueName: string;
  providerCode: ProviderCode;
  providerName: string;
  /**
   * The provider's adapter id, as its feed's events and participants name it, read through
   * `providerSourceIdOf`.
   */
  providerId: string;
}

/** A real-world league, tour or conference within a sport — the PGA Tour, the NBA. Never the product's League. */
export interface SportLeague extends DomainEntity {
  sportId: string;
  name: string;
  /** Its name in addresses within its sport (#2042): `?league=wnba`. Stored, never built from the name. */
  urlSegment: string;
  /**
   * Its current Season (#2003): recomputed once a day by `currentSeasonOf`, never set by hand.
   * Null only for a league no migration has given a Season.
   */
  currentSeasonId: string | null;
  /** The IANA time zone its calendar weeks break in (#2003). Set by migration. */
  timeZone: string;
  isActive: boolean;
  /**
   * The provider league whose sync creates and keeps its events (ADR 0011, #1997): one of its own
   * provider mappings. Null: the league is not synced.
   */
  selectedProviderMapping: SportLeagueProviderMapping | null;
  /**
   * How many days before its start a synced DRAFT event is released on its own once every ready
   * check passes (#1823); null releases only by hand. 1 to 30, 7 for a new league.
   */
  autoReleaseDaysBeforeStart: number | null;
  /**
   * The tier profile a new event of the league starts with and is auto-tiered by (#1844): the
   * College Football Playoff's six tiers of two. Every league names one.
   */
  platformTierProfileId: string;
  /** The pricing profile its events' fields are priced with after a sync (#1844). Every league names one. */
  platformPricingProfileId: string;
  /**
   * The periods its games are played in, when not its sport's (#786: men's college basketball's
   * halves); null plays the sport's layout. Read through `matchPeriodsOf`. Reference data, set
   * where the league is seeded.
   */
  matchPeriodLayout: MatchPeriodLayout | null;
  /**
   * The first round whose matches are single games a squares pool can be played on; null when
   * every round's are (#787: the Champions League's two-legged ties and MLS's best-of-three
   * series are one match each). Read through `isSquaresRound`. Reference data, set where the
   * league is seeded.
   */
  squaresFromRound: number | null;
  /**
   * What screens call it, when not what its sport calls a sport league (#834: the NCAA's tennis
   * championships are leagues, not tours); null takes the sport's. Read through
   * `sportLeagueNounOf`. Reference data, set where the league is seeded.
   */
  noun: SportLeagueNoun | null;
  /**
   * Where it sits among its sport's leagues wherever they are listed together: the major
   * professional leagues first, then the NCAA's. Lower comes first; null comes after every
   * ordered league. Reference data, set where the league is seeded.
   */
  displayOrder: number | null;
  /**
   * Who competes and how its events are scored (#2001): the league is the one home of both.
   * Read through `sportLeagueDefinitionOf`. Reference data, set where the league is seeded.
   */
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
}

/**
 * The Season slot a round is played in (#2006), as every reader of the round needs it: what it is
 * called and what kind of slot it is (the final is the slot kind FINAL, never the last round), and
 * how its matches are played.
 */
export interface SportEventRoundSlot {
  seasonSlotId: string;
  /** The definition's proper name; null when screens show the word for its kind. */
  name: string | null;
  slotKind: SlotKind;
  /** A WEEK slot's week number; null for every other kind. */
  weekNumber: number | null;
  /** How many games a match of the slot is played over, copied to the Season slot from its definition. */
  seriesGames: number;
  /** Whether the slot's matches are set by fixed links or reseeded. */
  pairing: SlotPairing;
}

/** What a match reads of its round's slot (#2006): its label's facts and its kind. */

/** A scheduled sub-period of an event — a golf round, a match day — played in one of its slots. */
export interface SportEventRound extends DomainEntity {
  sportEventId: string;
  roundNumber: number;
  scheduledDate: Date;
  scheduledEndAt: Date | null;
  slot: SportEventRoundSlot;
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

/** A pick tier an event's field is divided into. Cross-sport: nothing here is golf. */
export interface SportEventTier extends DomainEntity {
  sportEventId: string;
  tierKey: string;
  label: string;
  tierNumber: number;
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

// --- Finish-position extension row (#622) -----------------------------------
// Keyed 1:1 to a field row: a race is one result per runner.

/**
 * How one runner's race ended, as the admin entered it. `finishPosition` is set only for a
 * FINISHED runner (1 is the winner; a dead heat repeats a place), and a result counts in contest
 * scoring only once `isOfficial`. `riderName` is the jockey for this start.
 */
export interface SportEventParticipantRaceResult extends DomainEntity {
  sportEventParticipantId: string;
  finishPosition: number | null;
  startPosition: number | null;
  resultStatus: RaceResultStatus;
  isOfficial: boolean;
  riderName: string | null;
}

// --- Matches (#698) -----------------------------------------------------------
// Core event data, beside the round schedule: one game of one round, two sides and a result.

/**
 * One game or match of an event, played in one of its rounds. In a knockout bracket it is also a
 * bracket slot: `advancesToMatchId` and `advancesToSide` name the match and side its winner moves
 * on to (null for the final). A side is a field row, null until it is decided (a later-round slot
 * waiting on its feeder match). A COMPLETED match with no `winnerSide` is a draw, which a knockout
 * never allows. In a series (the NBA's best of seven) the scores are games won.
 */
export interface SportEventRoundMatch extends DomainEntity {
  sportEventId: string;
  /** The round it is played in, by number. */
  roundNumber: number;
  /** The slot its round is played in (#2006): what the round is called, and whether it is the FINAL. */
  slot: SportEventRoundSlot;
  /** Unique within the event: the bracket slot and the display order. */
  matchNumber: number;
  homeSportEventParticipantId: string | null;
  awaySportEventParticipantId: string | null;
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  status: MatchStatus;
  winnerSide: MatchSide | null;
  homeScore: number | null;
  awayScore: number | null;
  /**
   * The shoot-out that settled a knockout match level after extra time (#791): both sides' kicks
   * scored, or neither. Not part of the match score (IFAB Law 10), which every scorer reads, so
   * only the winner it names counts. Null in a sport without shoot-outs (`SportDefinition.shootout`).
   */
  homeShootoutScore: number | null;
  awayShootoutScore: number | null;
  /**
   * How the match ended (#704): PLAYED unless it stopped early (a retirement, a walkover or a
   * default). A match without a result is PLAYED.
   */
  ending: MatchEnding;
  advancesToMatchId: string | null;
  advancesToSide: MatchSide | null;
  /** The bracket region or conference ("East", "AFC"); null where the bracket has none. */
  regionLabel: string | null;
  /**
   * The points spread from the home team's side (#720): -3.5 has the home team favoured by 3.5,
   * +3.5 has it getting 3.5. Null until set. A pick'em contest scored against the spread reads it.
   */
  homeSpread: number | null;
  /**
   * The provider game the match takes its score from (#1496), at the provider its event is
   * mapped to (`SportEvent.providerMappings`); null until the sync or an admin links it.
   */
  externalGameId: string | null;
  /**
   * Who set the result (#1531): an admin, or the provider of the linked game; null while the
   * match has none. A cancelled match was cancelled by an admin.
   */
  resultSource: MatchResultSource | null;
  /**
   * When the result was last recorded (#1889): each write of a COMPLETED result sets it, a
   * correction included; null in every other status.
   */
  completedAt: Date | null;
  /**
   * The score at the end of each period entered so far (#772), in period order: the end of each
   * quarter but the last in American football. The final score is `homeScore`/`awayScore`.
   * Empty for a sport without periods (`SportDefinition.matchPeriods`).
   */
  periodScores: readonly SportEventMatchPeriodScore[];
}

/** Both sides' score at the end of one period of a game, as the scoreboard shows it (#772). */
export interface SportEventMatchPeriodScore {
  /** 1 for the first period; never the last, whose score is the match's final result. */
  periodNumber: number;
  homeScore: number;
  awayScore: number;
}
