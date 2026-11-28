/**
 * What the sync tick reads to decide what is due (#2009): the slots and Games the model holds,
 * never an event's status. Each read is a fixed few statements however many leagues, slots and
 * Games there are.
 */

import type { FieldWindowSlot, ProviderCode, ScoresGame } from '../domain';

/** A synced league as the tick reads it: its id and the provider mapping its events are linked under. */
export interface SyncedLeagueRef {
  sportLeagueId: string;
  sportLeagueProviderMappingId: string;
}

/** An event the scores sync may be due on: its Games due or in play now, and when its provider was last heard from. */
export interface LiveEventView {
  sportEventId: string;
  sportLeagueId: string;
  /** Its due and in-play Games: their status, start, and whether each is played as a FIELD (a golf round, a race). */
  games: ReadonlyArray<ScoresGame & { playedAsField: boolean }>;
  /** The latest webhook notification about the event or any of its Games; null before the first. */
  lastHeardAt: Date | null;
  /** When a completed scores sync of the event last changed something (#2094); null before the first. */
  lastScoresChangedAt: Date | null;
}

/** A Game that may be overdue (`gameOverdueExpectedEnd`): its event, its league, and each provider's id for it. */
export interface OverdueGameView extends ScoresGame {
  sportEventId: string;
  sportLeagueId: string;
  /** The Game's ids, one per provider that maps it. */
  providerGameIds: ReadonlyArray<{ providerCode: ProviderCode; externalId: string }>;
}

/** One Season's span, as the tick reads it to tell whether its league is in season (`syncSeasonStateOf`). */
export interface SeasonSpanView {
  sportLeagueId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface SyncDueWorkReader {
  /** The leagues' Seasons that have not ended by `now`, in one read: what `syncSeasonStateOf` reads. */
  findSeasonSpans(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<SeasonSpanView[]>;
  /**
   * The slots each league plays next (`fieldWindowEventIds`): of the league's synced Season slots
   * starting after `now` with an event linked under its provider mapping, those with the earliest
   * start, each with that event. A test slot never is.
   */
  findNextSlots(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<FieldWindowSlot[]>;
  /**
   * The leagues' linked events with a Game whose scores are due at `now` (`isGameScoresDue`), each
   * with those Games and when its scores last changed, in two reads.
   */
  findLiveEvents(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<LiveEventView[]>;
  /**
   * Which of the leagues have a roster to sync (#2025): those whose provider mapping names the
   * provider's code for at least one of the league's positions. In one read.
   */
  /**
   * The leagues' Games that may be overdue, or postponed with no new date, at `now` (#2013): of
   * their linked events, still scheduled, in progress or postponed, not moved to another Game, and
   * scheduled to start before `overdueStartCutoff(now)`. In one read; the tick judges each by its
   * league's typical length, or by the postponed wait.
   */
  findOverdueGames(input: { leagues: readonly SyncedLeagueRef[]; now: Date }): Promise<OverdueGameView[]>;
  findRosteredLeagueIds(input: { leagues: readonly SyncedLeagueRef[] }): Promise<Set<string>>;
}
