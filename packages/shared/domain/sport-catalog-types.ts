/**
 * Domain types for the cross-sport catalog and event core (#235): who competes in
 * which sport league, the calendar, and each participant's round-by-round and
 * running state within an event. Each mirrors its `schema.prisma` model; sport
 * particulars live in sport extension rows and are not part of these types.
 */

import type { ScoringFamily } from './sports/scoring-family';
import type { ProviderCode, HomeAway, MatchEnding, MatchSideOutcome, MatchStatus, PeriodKind, ParticipantRoundStatus, ParticipantType, ParticipantStandingStatus, RaceResultStatus, SeasonSlotStatus, SlotKind, SlotPairing, SportLeagueNoun, ValuationSource } from './enums';
import type { DomainEntity } from './types';
import type { SlotPricing } from './budget-pricing';
import type { SlotTierLayout } from './tier-profiles';
import type { SlotPeriods } from './slot-periods';

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
  /** The slot definition the Season slot plays: what a contest template lists, and so what a contest covers (#2014). */
  slotDefinitionId: string;
  /** The definition's proper name; null when screens show the word for its kind. */
  name: string | null;
  slotKind: SlotKind;
  /** A WEEK slot's week number; null for every other kind. */
  weekNumber: number | null;
  /** How many games a match of the slot is played over, copied to the Season slot from its definition. */
  seriesGames: number;
  /** Whether the slot's matches are set by fixed links or reseeded. */
  pairing: SlotPairing;
  /**
   * Whether a game of the slot can finish level (#2043), read from its definition: a level final
   * score is then a tie; where it cannot, only a shoot-out decides a level score (#2046).
   */
  canEndTied: boolean;
  /** What a game of the slot is played in (#2047), from its definition; null for a game kept by no period. */
  periods: SlotPeriods | null;
  /**
   * The match whose Game is the slot's tiebreaker game (#2048): the one Game whose combined score
   * every contest covering the slot guesses. Null until the slot has a scheduled Game.
   */
  tiebreakerMatchId: string | null;
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
}

/**
 * A pick tier of an event slot's team tier set (#2044): a set is built for each event slot a
 * template lists as a starting point. Cross-sport: nothing here is golf.
 */
export interface SportEventSlotTier extends DomainEntity {
  sportEventSlotId: string;
  tierKey: string;
  /** 1 is the top tier; its words are `tierLabel(tierNumber)` (#2047). */
  tierNumber: number;
}

/**
 * A field row's tier placement and price in one event slot's set (#2044). Tier and price are set
 * independently — either may be null — and each records how it was set.
 */
export interface SportEventSlotParticipantValuation extends DomainEntity {
  sportEventSlotId: string;
  sportEventParticipantId: string;
  sportEventSlotTierId: string | null;
  tierOrderIndex: number | null;
  tierAssignedSource: ValuationSource | null;
  price: number | null;
  priceAssignedSource: ValuationSource | null;
}

/**
 * An event slot as its team tier set reads it (#2044): where it is in play, and what the set was
 * last tiered and priced with.
 */
export interface SportEventTierSlot {
  /** The event slot (SportEventSlot). */
  id: string;
  sportEventId: string;
  /** The Season slot it is. */
  seasonSlotId: string;
  seasonSlotStatus: SeasonSlotStatus;
  /**
   * Whether it is its event's tier-set slot (`chooseTierSetSlot`): the slot today's tiered and budget
   * contests read, whose set is built while the event is a draft.
   */
  isTierSetSlot: boolean;
  /** The layout the set was last auto-tiered with; null until it first is. */
  tierLayout: SlotTierLayout | null;
  /** The values the set was last priced with, and the profile they started from; null until it is priced. */
  pricing: SlotPricing | null;
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
 * bracket slot: `advancesToMatchId` and `advancesToSideNumber` name the match and side its winner
 * moves on to (null for the final). Its two `sides` (#2046) are in side-number order, each a field
 * row or empty until it is decided (a later-round slot waiting on its feeder match). Its `games`
 * hold each side's score; a single game is Game 1, a best-of series one Game per game played.
 */
export interface SportEventRoundMatch extends DomainEntity {
  sportEventId: string;
  /** The round it is played in, by number. */
  roundNumber: number;
  /** The slot its round is played in (#2006): what the round is called, and whether it is the FINAL. */
  slot: SportEventRoundSlot;
  /** Unique within its round (#2161): the match's place in the round and its display order. */
  matchNumber: number;
  scheduledDate: Date | null;
  /** Rolled up from the Games by the result writer. */
  status: MatchStatus;
  /**
   * How the match ended (#704): PLAYED unless it stopped early (a retirement, a walkover or a
   * default). A match without a result is PLAYED.
   */
  ending: MatchEnding;
  advancesToMatchId: string | null;
  /** The `sideNumber` of the next match's side the winner fills; set exactly with `advancesToMatchId`. */
  advancesToSideNumber: number | null;
  /** The bracket region or conference ("East", "AFC"); null where the bracket has none. */
  regionLabel: string | null;
  /** Side 1 then side 2 (#2046). */
  sides: readonly SportEventRoundMatchSide[];
  /** The match's Games in game-number order, each with its side results (#2046). */
  games: readonly SportEventRoundMatchGame[];
}

/**
 * One side of a match (#2046): its fixed place, set by whoever created the match (the sync puts the
 * away team on side 1 and the home team on side 2), and the field row playing it, null until known.
 */
export interface SportEventRoundMatchSide {
  id: string;
  sideNumber: number;
  sportEventParticipantId: string | null;
  /**
   * The points spread, on side 1 only: -3.5 has side 1 favoured by 3.5, +3.5 has it getting 3.5.
   * Null until set, and always on side 2. A pick'em contest scored against the spread reads it.
   */
  spread: number | null;
  /** Rolled up from the Games by the result writer; PENDING until the match is decided. */
  outcome: MatchSideOutcome;
}

/**
 * One game of a match (#2007): a single-game match has its Game 1, a best-of series one Game per
 * game played. Every match has its Game 1 from the moment it is loaded. A Game holds the provider's
 * score of that game alone, as each side's result (#2046). Its provider game ids are its provider
 * mappings, one per provider.
 */
export interface SportEventRoundMatchGame extends DomainEntity {
  sportEventId: string;
  sportEventRoundMatchId: string;
  /** The slot the match's round is played in, the same as the round's. */
  sportEventSlotId: string;
  /** 1 for the first game of its match; a series' games in the order they are played. */
  gameNumber: number;
  scheduledDate: Date | null;
  /** Neither side plays at home (#2047); its side results then say NONE for home or away. */
  isNeutralSite: boolean;
  /**
   * Where the game is played (#2047), its arena and city: a series moves between both sides'
   * homes, so each Game has its own. Null until a feed sends one; a golf course stays on its event.
   */
  venue: string | null;
  location: string | null;
  status: MatchStatus;
  /** When the game was last written COMPLETED; null for any other status. */
  completedAt: Date | null;
  /**
   * The Game this one was moved to (#2007): a provider that moves a game to another week keeps
   * this Game, and whatever is tied to it, and plays the game at the other event's Game. Null for
   * a game that was not moved.
   */
  movedToGameId: string | null;
  /** When a provider last sent a notification about the game (#1499); null until one does. */
  lastProviderNotificationAt: Date | null;
  /** Each side's result in this game, in side-number order; empty for neither side yet written. */
  sideResults: readonly SportEventRoundMatchGameSideResult[];
}

/** One side's result in one Game (#2046). */
export interface SportEventRoundMatchGameSideResult {
  sportEventRoundMatchSideId: string;
  sideNumber: number;
  /** The side's score in the game, overtime included and a shoot-out never; null until it starts. */
  score: number | null;
  homeAway: HomeAway;
  /** The side's own points in each period, in play order; a shoot-out is one SHOOTOUT period. */
  periodScores: readonly GamePeriodScore[];
}

/** The points one side scored in one period of a game (#2046): that period's own, not a running total. */
export interface GamePeriodScore {
  kind: PeriodKind;
  periodNumber: number;
  score: number;
}

/** A Game's id at one provider (#2007): the provider's game id the Game takes its score from. */
export interface SportEventRoundMatchGameProviderMapping {
  sportEventRoundMatchGameId: string;
  providerCode: ProviderCode;
  externalId: string;
}

