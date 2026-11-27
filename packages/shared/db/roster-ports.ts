/**
 * What the roster sync reads and writes (#2025): a sport league's roster rows for its current
 * Season, each naming a player's team and position by id (`SportLeagueSeasonParticipantTeam`).
 */

import type { BackgroundJobRequest, ProviderCode } from '../domain';

/** A provider's code for one of a league's positions, as its provider mapping names it. */
export interface RosterPositionCode {
  providerCode: string;
  sportLeaguePositionId: string;
  isFieldEligible: boolean;
}

/** The league's ids a roster's feed ids name, read once for the whole roster. */
export interface RosterIds {
  /** The Provider row the code names: the one new players' mappings are keyed to. */
  providerId: string;
  /** Each of the feed's team ids that a TEAM participant of the league is mapped from, to that team. */
  teamIdByExternalId: Map<string, string>;
  /** Each of the feed's player ids that an individual participant of the league is mapped from, to that player. */
  playerByExternalId: Map<string, { participantId: string; name: string }>;
  /** The Season's roster rows of those players, by player. */
  rowByPlayerId: Map<string, { teamParticipantId: string; sportLeaguePositionId: string }>;
}

/** One roster's writes, in one transaction. */
/** One player's roster row: their team and position by id. */
export interface RosterRowWrite {
  participantId: string;
  teamParticipantId: string;
  sportLeaguePositionId: string;
}

export interface RosterWrite {
  sportLeagueId: string;
  sportLeagueSeasonId: string;
  /** The Provider row the new players' mappings are keyed to (`RosterIds.providerId`). */
  providerId: string;
  /** Players the feed names for the first time: each a new individual participant of the league with its mapping. */
  newPlayers: ReadonlyArray<{ participantId: string; externalId: string; name: string }>;
  /** Players the feed now names differently. */
  renamedPlayers: ReadonlyArray<{ participantId: string; name: string }>;
  /** Roster rows the Season has none of yet, for players it now lists: written together, however many. */
  newRows: ReadonlyArray<RosterRowWrite>;
  /** The Season's rows of players now on another team or at another position (trades: few). */
  movedRows: ReadonlyArray<RosterRowWrite>;
  /** Every player the feed listed: their mapping and roster row were seen now. */
  seenPlayerIds: readonly string[];
  seenAt: Date;
  /** The new mappings' follow-ups, written with them. */
  jobs: readonly BackgroundJobRequest[];
}

export interface SportLeagueRosterRepository {
  /** The provider's codes for the league's positions, at its provider mapping. One read. */
  findPositionCodes(sportLeagueProviderMappingId: string): Promise<RosterPositionCode[]>;
  /** The league's teams and players these feed ids name, and the Season's rows of those players, in a fixed few reads. */
  findRosterIds(input: {
    sportLeagueId: string;
    sportLeagueSeasonId: string;
    providerCode: ProviderCode;
    teamExternalIds: readonly string[];
    playerExternalIds: readonly string[];
  }): Promise<RosterIds>;
  /** Writes one roster's changes in one transaction. A row whose team is not a TEAM participant is refused. */
  applyRoster(write: RosterWrite): Promise<void>;
}
