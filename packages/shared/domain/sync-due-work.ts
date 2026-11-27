/**
 * What the sync tick queues (#2009): the rules that decide which league's events sync, which
 * event's field and which event's scores are due, read by the tick and by nothing else. They read
 * dates the model holds (a Season slot's start, a Game's start and status, a job's last run),
 * never an event's status, which slice 14 writes from its Games.
 */

import { MatchStatus } from './enums';
import { overdueStartCutoff } from './event-overdue';

/** How often the sync tick runs: every due sync waits at most this long to be queued. */
export const SYNC_TICK_MS = 60_000;

/** How early within a tick a sync may come due, so a tick's own lag never skips one. */
const DUE_SLACK_MS = 5_000;

/**
 * Whether a sync that last ran at `lastRunAt` is due again at `now` on its `intervalMs`: always
 * when it never ran. An interval shorter than a tick comes due every tick.
 */
export function isSyncDue(lastRunAt: Date | undefined, intervalMs: number, now: Date): boolean {
  return lastRunAt === undefined || now.getTime() - lastRunAt.getTime() >= intervalMs - DUE_SLACK_MS;
}

/** A Season slot as the field window reads it: its league, its start, and the event played in it. */
export interface FieldWindowSlot {
  sportLeagueId: string;
  /** The slot's start: its first Game's (the Season slot's `startsAt`, the earliest of its Games). */
  startsAt: Date;
  sportEventId: string;
}

/**
 * The events whose field the tick syncs (#2009): those of each league's next slot. A league's
 * next slot is its earliest slot not yet started, across every competition of its Seasons, so of
 * two overlapping competitions (the CFP beside the bowls) the next is the earlier start, not the
 * next in a list. Every slot starting then is next. Each event once, in the order given.
 */
export function fieldWindowEventIds(slots: readonly FieldWindowSlot[], now: Date): string[] {
  const nextStart = new Map<string, number>();
  for (const slot of slots) {
    const startsAt = slot.startsAt.getTime();
    if (startsAt <= now.getTime()) continue;
    const earliest = nextStart.get(slot.sportLeagueId);
    if (earliest === undefined || startsAt < earliest) nextStart.set(slot.sportLeagueId, startsAt);
  }
  const eventIds = slots
    .filter((slot) => nextStart.get(slot.sportLeagueId) === slot.startsAt.getTime())
    .map((slot) => slot.sportEventId);
  return [...new Set(eventIds)];
}

/** A Game as the scores sync reads it: its status and its scheduled start. */
export interface ScoresGame {
  status: MatchStatus;
  scheduledDate: Date | null;
}

/**
 * The earliest scheduled start a due Game may have (#2009): a Game left SCHEDULED past this is
 * overdue (`overdueStartCutoff`), and polling it again changes nothing, so it waits for its event's
 * next Game or a root admin's Sync now.
 */
export function scoresDueSince(now: Date): Date {
  return overdueStartCutoff(now);
}

/**
 * Whether a Game's scores are synced at `now` (#2009): one in progress, and one scheduled whose
 * start has come but not more than an overdue event's time ago. A finished, cancelled or
 * postponed Game is not.
 */
function isGameScoresDue(game: ScoresGame, now: Date): boolean {
  if (game.status === MatchStatus.IN_PROGRESS) return true;
  if (game.status !== MatchStatus.SCHEDULED || game.scheduledDate === null) return false;
  return game.scheduledDate <= now && game.scheduledDate >= scoresDueSince(now);
}

/**
 * When play got under way in an event's due Games (#1499): the earliest start among them, or null
 * when none has a scheduled start, since a row's last change is not when play began.
 */
export function playUnderwaySince(games: readonly ScoresGame[], now: Date): Date | null {
  const starts = games
    .filter((game) => isGameScoresDue(game, now) && game.scheduledDate !== null)
    .map((game) => game.scheduledDate?.getTime() ?? 0);
  return starts.length === 0 ? null : new Date(Math.min(...starts));
}

/**
 * Whether the tick warns that a notified provider's event in play has gone quiet (#1499): it has
 * been in play `quietAfterMs` or longer since its provider was last heard from, and this tick is
 * the one that crosses a whole multiple of `quietAfterMs`, so the warning comes once per quiet
 * stretch without the tick remembering anything.
 */
export function isQuietWarningDue(input: {
  playUnderwaySince: Date;
  lastHeardAt: Date | null;
  quietAfterMs: number;
  now: Date;
  tickMs: number;
}): boolean {
  const heardFrom = Math.max(input.playUnderwaySince.getTime(), input.lastHeardAt?.getTime() ?? 0);
  const quietMs = input.now.getTime() - heardFrom;
  if (input.quietAfterMs <= 0 || quietMs < input.quietAfterMs) return false;
  return quietMs % input.quietAfterMs < input.tickMs;
}
