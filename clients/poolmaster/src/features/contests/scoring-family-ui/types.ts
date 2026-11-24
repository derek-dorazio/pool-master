/**
 * What a scoring family contributes to the shared contest screens (#606). The leaderboard's
 * frame — entry bars, position, name, total, search, paging — is the same in every sport; the
 * columns after the total, their cells, the pick totals and any footnote are the family's;
 * the entry total is one number in every family (#695). A family answers in data, so the page
 * renders every family through one markup.
 */

import type { SportDefinition } from '@poolmaster/shared/domain';
import type {
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
  SportEventMatchDto,
  SportEventParticipantDto,
} from '@/lib/api';

/** One of the family's columns after the total. */
export interface LeaderboardDetailColumn {
  /** Unique within the board; the React key. */
  key: string;
  /** The column header as shown. */
  label: string;
  /** Selector for the header cell, when automation needs one. */
  testId?: string;
  /** The CSS grid track the column takes. */
  width: string;
  /** Set on the column of a game being played right now: its head carries a Live marker. */
  isLive?: boolean;
}

/** One cell under a detail column, in the same order as the columns. */
export interface LeaderboardDetailCell {
  key: string;
  testId: string;
  /** Already formatted. Null renders as a dash. */
  text: string | null;
  /**
   * Set when the participant did not play this cell's part of the event and it counts at a
   * fixed value instead: the cell is set apart, and the explanation is named for a screen reader.
   * The board's footnote explains it on screen.
   */
  unplayed?: { ariaLabel: string };
  /**
   * What the cell's score was made of (a team's games in the round), shown in a small
   * popover when the score is hovered, tapped or pressed. Absent where the cell has none.
   */
  peek?: { title: string; facts: Array<{ label: string; value: string }> };
  /** Set where the cell is a status: its text shows as a chip, `success` for a team still in. */
  chip?: 'success' | 'neutral';
}

/** A note under the board that explains something the family's cells show. */
export interface LeaderboardFootnote {
  testId: string;
  text: string;
}

/** The family's part of one pick's row. */
export interface LeaderboardPickDetail {
  /** The pick's score in this contest, formatted; what the entry's total sums. Null while unscored. */
  total: string | null;
  detailCells: LeaderboardDetailCell[];
  /**
   * A line under the participant's name, shown while the entry's Stats switch is on: a team's
   * latest result. Absent for a family that has none, and before the event has any.
   */
  statLine?: string;
}

/** The family's part of one leaderboard, resolved against that leaderboard's response. */
export interface ScoringFamilyLeaderboard {
  detailColumns: LeaderboardDetailColumn[];
  footnote: LeaderboardFootnote | null;
  pickDetail(
    entryId: string,
    pick: ScoredContestEntryPickDto,
    participant: SportEventParticipantDto,
  ): LeaderboardPickDetail;
}

/**
 * The prediction an entry makes to break a tie (#606): what it asks for, the values on offer and
 * how one reads. A family with no prediction to make has none, and its entries submit without one.
 */
export interface EntryTiebreakerUi {
  /** The question, as the field's label: "Winning Score Relative to Par". */
  label: string;
  /** The empty choice: "Select score". */
  placeholder: string;
  /** The values an entry may choose, in the order offered. */
  options: readonly number[];
  /** How one value reads: "-12", "E". */
  format: (value: number) => string;
  /** A saved prediction in a sentence: "Winning score relative to par: -12". */
  describe: (value: number) => string;
}

/**
 * What a board knows beyond its response, for a family that describes a team's games (#1748):
 * the shown event's games, and how its rounds and kick-offs read. A board that reads none (a
 * league home's card) leaves it out, and the family shows only what the response says.
 */
export interface LeaderboardContext {
  /** The shown event's games (its bracket's matches), in match order. */
  games: readonly SportEventMatchDto[];
  /** A round as the event's bracket screens name it: "Sweet 16". */
  roundName: (roundNumber: number) => string;
  /** A game's start as the viewer reads it. */
  formatStart: (startsAt: string) => string;
}

/** One scoring family's web presentation. */
export interface ScoringFamilyUi {
  leaderboard(response: ContestLeaderboardResponse, sport: SportDefinition, context?: LeaderboardContext): ScoringFamilyLeaderboard;
  /** The entry's tiebreaker prediction, or null when the family asks for none. */
  entryTiebreaker: EntryTiebreakerUi | null;
}
