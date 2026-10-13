/**
 * What a scoring family contributes to the shared contest screens (#606). The leaderboard's
 * frame — entry bars, position, name, total, search, paging — is the same in every sport; the
 * columns after the total, their cells, the entry and pick totals and any footnote are the
 * family's. A family answers in data, so the page renders every family through one markup.
 */

import type { SportDefinition } from '@poolmaster/shared/domain';
import type {
  ContestEntryStandingDto,
  ContestLeaderboardResponse,
  ScoredContestEntryPickDto,
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
   */
  unplayed?: { ariaLabel: string; title: string };
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
}

/** The family's part of one leaderboard, resolved against that leaderboard's response. */
export interface ScoringFamilyLeaderboard {
  detailColumns: LeaderboardDetailColumn[];
  footnote: LeaderboardFootnote | null;
  /** The entry's total, formatted. Null until one of its picks is scored. */
  entryTotal(entry: ContestEntryStandingDto): string | null;
  pickDetail(
    entryId: string,
    pick: ScoredContestEntryPickDto,
    participant: SportEventParticipantDto,
  ): LeaderboardPickDetail;
}

/** One scoring family's web presentation. */
export interface ScoringFamilyUi {
  leaderboard(response: ContestLeaderboardResponse, sport: SportDefinition): ScoringFamilyLeaderboard;
}
