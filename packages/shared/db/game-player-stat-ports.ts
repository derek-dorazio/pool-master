/**
 * What the box score writer reads and writes (#2026): a Game's player stat rows
 * (`SportEventRoundMatchGamePlayerStat`), the Games' sides, and the players a box score's feed ids
 * name with their Season roster row's team.
 */

import type { ProviderCode, SportStat } from '../domain';

/** One side of a Game's Match: the participant playing it (a team, or a golfer), null while it is not known. */
export interface StatGameSide {
  sportEventRoundMatchSideId: string;
  participantId: string | null;
}

/** A Game a box score is written for, with what places its players. */
export interface StatGame {
  sportEventRoundMatchGameId: string;
  sportEventRoundMatchId: string;
  sportEventId: string;
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  /** The provider's own id for the Game, at the Provider asked; null when it has none. */
  providerGameId: string | null;
  sides: readonly StatGameSide[];
}

/** A player a box score's feed id names, with the team their Season roster row says they play for. */
export interface StatPlayer {
  participantId: string;
  /** Their roster row's team in the Season asked; null when they have no row in it. */
  teamParticipantId: string | null;
}

/** One stat row of a Game. */
export interface GamePlayerStatRow {
  sportEventRoundMatchId: string;
  sportEventRoundMatchGameId: string;
  sportEventRoundMatchSideId: string;
  participantId: string;
  stat: SportStat;
  value: number;
}

export interface GamePlayerStatRepository {
  /** The Games, with their sides, their event's Season and the Provider's id for each. One read. */
  findStatGames(input: { sportLeagueId: string; providerCode: ProviderCode; sportEventRoundMatchGameIds: readonly string[] }): Promise<StatGame[]>;
  /**
   * The league's players these feed ids are mapped from, at the Provider, each with their roster
   * row's team in the Season. Two reads, however many players.
   */
  findStatPlayers(input: { sportLeagueId: string; sportLeagueSeasonId: string; providerCode: ProviderCode; playerExternalIds: readonly string[] }): Promise<Map<string, StatPlayer>>;
  /** The Games' stat rows. One read. */
  findGameStats(sportEventRoundMatchGameIds: readonly string[]): Promise<GamePlayerStatRow[]>;
  /**
   * Replaces the Games' stat rows with these, in one transaction: each Game named keeps only the
   * rows given for it. The database refuses a side that is not one of its Game's Match's.
   */
  replaceGameStats(input: { sportLeagueId: string; sportEventRoundMatchGameIds: readonly string[]; rows: readonly GamePlayerStatRow[] }): Promise<void>;
}
