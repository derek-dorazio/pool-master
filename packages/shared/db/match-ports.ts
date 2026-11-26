/**
 * Repository port for an event's matches (#698): its bracket. The admin loads the whole bracket
 * at once and edits one match at a time; results (#699) and period scores (#772) are written by
 * the head-to-head family.
 */

import type { BackgroundJobRequest, GamePeriodScore, HomeAway, MatchEnding, MatchSideOutcome, MatchStatus, ParticipantStandingStatus, ProviderCode, SportEventRoundMatch, SportEventRoundMatchGame } from '../domain';

/** One side of a match being created (#2046): its fixed number, its team or none yet, and where it plays Game 1. */
export interface MatchSideWrite {
  sideNumber: number;
  sportEventParticipantId: string | null;
  homeAway: HomeAway;
}

/** One match of a bracket being loaded. `id` is chosen by the caller so links can name it. */
export interface SportEventRoundMatchWrite {
  id: string;
  roundNumber: number;
  matchNumber: number;
  /** Both sides, side 1 and side 2. */
  sides: readonly MatchSideWrite[];
  isNeutralSite: boolean;
  scheduledDate: Date | null;
  advancesToMatchId: string | null;
  advancesToSideNumber: number | null;
  regionLabel: string | null;
}

/** A side's team set, or emptied, by its number. */
export interface MatchSideTeam {
  sideNumber: number;
  sportEventParticipantId: string | null;
}

/** What one match edit changes; a value left out keeps what is stored. */
export interface SportEventRoundMatchPatch {
  /** The sides whose team changes. */
  sides?: readonly MatchSideTeam[];
  isNeutralSite?: boolean;
  scheduledDate?: Date | null;
  /** Side 1's spread (#720). */
  spread?: number | null;
  /** Where each side plays Game 1 (#2046): a provider listing the teams the other way round changes only this. */
  gameOneHomeAway?: readonly { sideNumber: number; homeAway: HomeAway }[];
}

/** One side's score in a Game, and its shoot-out kicks scored when one settled the game. */
export interface GameSideScoreWrite {
  sideNumber: number;
  score: number | null;
  /** Null for a game no shoot-out settled: its SHOOTOUT period goes. */
  shootoutScore: number | null;
}

/**
 * A match's result as it is written (#2046): its status, each side's outcome and, for a
 * single-game match, its Game 1's side scores. Cleared is SCHEDULED with every outcome PENDING.
 */
export interface MatchResultWrite {
  id: string;
  status: MatchStatus;
  ending: MatchEnding;
  /** When a COMPLETED result was written (#1889); null for any other status. */
  completedAt: Date | null;
  outcomes: readonly { sideNumber: number; outcome: MatchSideOutcome }[];
  /**
   * Game 1's side scores in a single-game match, whose Game 1 takes the match's status and
   * completion time with them; null leaves the match's Games as they are (a series, a cancellation).
   */
  gameOne: { gameId: string; scores: readonly GameSideScoreWrite[] } | null;
}

/**
 * A match's status while it is played (#1496), rolled up from its Games: IN_PROGRESS, or SCHEDULED
 * or POSTPONED once the provider says it has not started after all. It decides nothing; only a
 * result does. The score is its Games'.
 */
export interface MatchStatusWrite {
  id: string;
  status: Extract<MatchStatus, 'SCHEDULED' | 'IN_PROGRESS' | 'POSTPONED'>;
}

/** One side of a later match, set to the team that advances into it, or emptied. */
export interface MatchSideFill {
  id: string;
  sideNumber: number;
  sportEventParticipantId: string | null;
}

/** A team's core standing in the event, written from the bracket's results. */
export interface BracketStandingWrite {
  sportEventParticipantId: string;
  /** 1 is the champion; teams out in the same round share a place. */
  position: number | null;
  displayPosition: string | null;
  status: ParticipantStandingStatus;
  asOf: Date;
}

export interface MatchResultApply {
  result: MatchResultWrite;
  /** The next match's side the winner fills, when the match advances anywhere. */
  sideFill: MatchSideFill | null;
  /** Created or replaced, one per team in the bracket. */
  standings: readonly BracketStandingWrite[];
  /** Background jobs the result causes (settling the game's squares contests), written with it. */
  jobs?: readonly BackgroundJobRequest[];
}

/** Each side's own points per period of one Game (#2046), replacing the Game's REGULAR and OVERTIME periods. */
export interface GamePeriodScoresWrite {
  sportEventRoundMatchId: string;
  gameId: string;
  sides: readonly { sideNumber: number; periodScores: readonly GamePeriodScore[] }[];
}

export interface SportEventRoundMatchRepository {
  /** One match, or null when there is none: a squares grid's game (#1201). */
  findById(id: string): Promise<SportEventRoundMatch | null>;
  /** The event's matches in match-number order, each with its sides and Games. */
  findBySportEvent(sportEventId: string): Promise<SportEventRoundMatch[]>;
  /** Several events' matches in one read (#762), each event's in match-number order. */
  findBySportEvents(sportEventIds: readonly string[]): Promise<SportEventRoundMatch[]>;
  /**
   * Replaces every match of the event with `matches`, each with its two sides and its Game 1
   * (#2007, #2046), all or none. Every round named must exist. Each bracket write takes the
   * background jobs it causes (the event's leaderboard rebuild, #1466) and writes them with it.
   */
  replaceBracket(sportEventId: string, matches: readonly SportEventRoundMatchWrite[], jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  update(id: string, patch: SportEventRoundMatchPatch, jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /**
   * Writes each match's status while it is played, all or none. A match that has since been given
   * a result or cancelled keeps it: only a scheduled, postponed or in-progress match takes one.
   */
  applyStatuses(statuses: readonly MatchStatusWrite[]): Promise<void>;
  /** Both sides of each match given, all or none: a reseeded round's teams placed (#722). */
  placeSides(matches: readonly { id: string; sides: readonly MatchSideTeam[] }[], jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /** A result entered or cleared, the side it fills and the standings it leaves, all or none. */
  applyResult(apply: MatchResultApply): Promise<void>;
  /** Writes one Game's period scores (#772, #2046), with any background jobs it causes in the same transaction. */
  saveGamePeriodScores(write: GamePeriodScoresWrite, jobs?: readonly BackgroundJobRequest[]): Promise<void>;
}

/** A Game with the one provider's id for it, when it has one (#2007). */
export interface ProviderMappedGame {
  game: SportEventRoundMatchGame;
  /** The provider's game id the Game is mapped to; null while it has none at this provider. */
  externalId: string | null;
}

/** A Game the score sync creates, for a series game it has not seen before, with its provider id. */
export interface SportEventRoundMatchGameCreate {
  id: string;
  sportEventId: string;
  sportEventRoundMatchId: string;
  sportEventSlotId: string;
  gameNumber: number;
}

/** A Game's provider score, written as the provider reports the game (#2007, #2046). */
export interface SportEventRoundMatchGameScoreWrite {
  id: string;
  sportEventRoundMatchId: string;
  status: MatchStatus;
  /** Each side's score, where it played this game, and its shoot-out kicks scored. */
  sides: readonly (GameSideScoreWrite & { homeAway: HomeAway })[];
  /** When a COMPLETED game was written; null in any other status. */
  completedAt: Date | null;
}

/**
 * What one score sync writes to an event's Games, all or none: the Games it creates, the provider
 * ids it maps (a mapping moves to its new Game, taking the place of the Game's old id at the
 * provider), the Games it marks moved and each Game's score.
 */
export interface SportEventRoundMatchGameSync {
  providerCode: ProviderCode;
  created: readonly SportEventRoundMatchGameCreate[];
  mapped: readonly { sportEventRoundMatchGameId: string; externalId: string }[];
  moved: readonly { id: string; movedToGameId: string }[];
  scores: readonly SportEventRoundMatchGameScoreWrite[];
}

/** Repository port for the Games of an event's matches (#2007) and their provider ids. */
export interface SportEventRoundMatchGameRepository {
  /** Every Game of the event's matches, with the provider's id for each, by match and game number. */
  findBySportEvent(sportEventId: string, providerCode: ProviderCode): Promise<ProviderMappedGame[]>;
  /** The Games the provider's game ids are mapped to, in any event: one per id at most. */
  findByProviderExternalIds(providerCode: ProviderCode, externalIds: readonly string[]): Promise<ProviderMappedGame[]>;
  /** One score sync's writes, all or none, with the jobs that follow them. */
  applySync(sync: SportEventRoundMatchGameSync, jobs?: readonly BackgroundJobRequest[]): Promise<void>;
  /** Records when a provider's notification about each of these Games arrived (#1499). */
  recordProviderNotification(gameIds: readonly string[], receivedAt: Date): Promise<void>;
}
