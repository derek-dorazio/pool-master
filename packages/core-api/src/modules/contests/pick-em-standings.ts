/**
 * A pick'em contest's week standings (#717): each entry that submitted the week, its picks scored
 * against the week's games and ranked, with the week's last game's total points as the
 * tiebreaker. One read for the live leaderboard and for settlement, so the two cannot drift
 * apart, as bracket-standings.ts is for brackets. The scoring rules are in game-picks.ts.
 */
import type { ContestEntryWithSquad } from '@poolmaster/shared/db';
import {
  MatchStatus,
  SelectionType,
  SportEventStatus,
  contestEntryEventTiebreaker,
  type PickEmMode,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { rankPredictionStandings, type BracketScore } from '../scoring-families/head-to-head/bracket-picks';
import { gameTotalPoints, scoreGamePicks, weekTiebreakerGame } from '../scoring-families/head-to-head/game-picks';
import type { BracketStandingsReadDeps } from './bracket-standings';

export type PickEmStandingsReadDeps = Pick<BracketStandingsReadDeps, 'configurations' | 'entries' | 'predictions' | 'matches'>;

export interface PickEmEntryStanding {
  entry: ContestEntryWithSquad;
  score: BracketScore;
  tiebreakerValue: number | null;
  position: number;
  displayPosition: string;
}

export interface PickEmWeekStandings {
  sportEventId: string;
  /** The week was cancelled: it counts for nothing (#743), so no entry scores and no game counts. */
  eventCancelled: boolean;
  /** The week's games, cancelled ones left out (all of them when the week was cancelled). */
  gameCount: number;
  /** The tiebreaker game's combined score once it is played: what the tiebreakers are measured against. */
  tiebreakerTotalPoints: number | null;
  /** Ranked, best first. */
  entries: PickEmEntryStanding[];
}

/** A pick'em contest whose stored rules are not pick'em rules: contest setup never writes one. */
export class PickEmRulesMissingError extends Error {
  constructor(readonly contestId: string) {
    super(`Contest ${contestId} carries no pick'em rules`);
    this.name = 'PickEmRulesMissingError';
  }
}

/** The contest's pick'em mode, read from its stored rules. */
export async function loadPickEmMode(
  deps: Pick<PickEmStandingsReadDeps, 'configurations'>,
  contestId: string,
): Promise<PickEmMode> {
  const rules = (await deps.configurations.findByContest(contestId))?.configJson;
  if (rules?.selectionType !== SelectionType.PICK_EM) {
    throw new PickEmRulesMissingError(contestId);
  }
  return rules.mode;
}

/** The week's games as they count (#743, #762): what both the week's standings and the season leaderboard read. */
export interface PickEmWeekGames {
  eventCancelled: boolean;
  /** Cancelled games left out; none when the week was cancelled. */
  games: SportEventMatch[];
  /** The tiebreaker game's combined score once it is played. */
  tiebreakerTotalPoints: number | null;
}

/**
 * The week's games out of its matches. A cancelled game is not one of the week's games, so its
 * picks score nothing; a cancelled week counts for nothing (#743).
 */
export function pickEmWeekGames(
  sportEvent: Pick<SportEvent, 'status' | 'startDate'>,
  matches: readonly SportEventMatch[],
): PickEmWeekGames {
  const eventCancelled = sportEvent.status === SportEventStatus.CANCELLED;
  const games = eventCancelled ? [] : matches.filter((match) => match.status !== MatchStatus.CANCELLED);
  return { eventCancelled, games, tiebreakerTotalPoints: gameTotalPoints(weekTiebreakerGame(games, sportEvent.startDate)) };
}

/**
 * The contest's entries that submitted the week, scored against its games and ranked. A caller
 * that already read the week's matches passes them in, so they are not read again.
 */
export async function loadPickEmWeekStandings(
  deps: PickEmStandingsReadDeps,
  contestId: string,
  sportEvent: Pick<SportEvent, 'id' | 'status' | 'startDate'>,
  mode: PickEmMode,
  weekMatches?: readonly SportEventMatch[],
): Promise<PickEmWeekStandings> {
  const sportEventId = sportEvent.id;
  const [entries, matches] = await Promise.all([
    deps.entries.findByContestWithSquad(contestId, { submittedFor: sportEventId }),
    weekMatches ?? deps.matches.findBySportEvent(sportEventId),
  ]);
  const { eventCancelled, games, tiebreakerTotalPoints: tiebreakerTotal } = pickEmWeekGames(sportEvent, matches);
  const predictions = await deps.predictions.findByEntriesAndEvent(entries.map((entry) => entry.id), sportEventId);

  const picksByEntry = new Map<string, typeof predictions>();
  for (const prediction of predictions) {
    const picks = picksByEntry.get(prediction.contestEntryId);
    if (picks) picks.push(prediction);
    else picksByEntry.set(prediction.contestEntryId, [prediction]);
  }

  const scored = entries.map((entry) => ({
    entry,
    score: scoreGamePicks(games, picksByEntry.get(entry.id) ?? [], mode),
    tiebreakerValue: contestEntryEventTiebreaker(entry, sportEventId),
  }));
  const ranks = new Map(rankPredictionStandings(
    scored.map(({ entry, score, tiebreakerValue }) => ({ entryId: entry.id, points: score.points, tiebreakerValue })),
    tiebreakerTotal,
  ).map((rank) => [rank.entryId, rank]));
  return {
    sportEventId,
    eventCancelled,
    gameCount: games.length,
    tiebreakerTotalPoints: tiebreakerTotal,
    entries: scored
      .flatMap((standing) => {
        const rank = ranks.get(standing.entry.id);
        return rank ? [{ ...standing, position: rank.position, displayPosition: rank.displayPosition }] : [];
      })
      .sort((left, right) => left.position - right.position || left.entry.entryNumber - right.entry.entryNumber || left.entry.name.localeCompare(right.entry.name)),
  };
}
