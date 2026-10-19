/**
 * Survivor (#719, plans/knockout-and-pickem-design.md §5.5): one entry's season of weekly picks,
 * read in week order. The pure rules, all here:
 *
 * - **Each week** the entry picks one team to win. It survives the week when that team wins, and
 *   when its game is cancelled (the entry did nothing wrong).
 * - **It is out** after a loss, a tie (no winner, as in pick'em), or a week that started with no
 *   submitted pick. Once out it plays no later week, whatever it picked there.
 * - **Each team once:** a team picked in a week the entry submitted is used for the rest of the
 *   season, by its participant, since each week has its own field rows.
 * - **The score** is the weeks survived: entries out in the same week tie, and entries still
 *   standing at the end share the win.
 */
import { MatchSide, MatchStatus, SurvivorWeekOutcome, type SportEventMatch } from '@poolmaster/shared/domain';

/** One week of the entry's season, as its read sees it. */
export interface SurvivorWeek {
  sportEventId: string;
  /** Whether the week's first game has kicked off: a week not started decides nothing yet. */
  started: boolean;
  /** The week was cancelled: it counts for nothing, so nobody is out for it. */
  cancelled: boolean;
  /** Whether the entry submitted the week. */
  submitted: boolean;
  /** The week's games, cancelled ones included: a pick on a cancelled game survives. */
  games: readonly SportEventMatch[];
  /** The entry's pick in the week, when it has one: the game and the team's field row. */
  pick: { sportEventMatchId: string; sportEventParticipantId: string } | null;
  /** The picked team's participant, which "each team once" is checked on. */
  pickedParticipantId: string | null;
}

/** The entry's outcome for one week, or null for a week it no longer plays or that decides nothing. */
export interface SurvivorWeekResult {
  sportEventId: string;
  outcome: SurvivorWeekOutcome | null;
}

export interface SurvivorRun {
  weeks: SurvivorWeekResult[];
  /** The index in `weeks` of the week that put the entry out; null while it is still standing. */
  eliminatedAt: number | null;
  /** How many weeks the entry survived: its score. */
  weeksSurvived: number;
  /** The participants the entry picked in the weeks it submitted, before it went out. */
  usedParticipantIds: Set<string>;
}

/** How a submitted pick stands against its game. */
export function survivorPickOutcome(
  games: readonly SportEventMatch[],
  pick: { sportEventMatchId: string; sportEventParticipantId: string },
): SurvivorWeekOutcome {
  const game = games.find((candidate) => candidate.id === pick.sportEventMatchId);
  // A pick on a game no longer in the week (moved away before release) has nothing to lose.
  if (!game || game.status === MatchStatus.CANCELLED) return SurvivorWeekOutcome.SURVIVED;
  if (game.status !== MatchStatus.COMPLETED) return SurvivorWeekOutcome.PENDING;
  const winner = game.winnerSide === MatchSide.HOME
    ? game.homeSportEventParticipantId
    : game.winnerSide === MatchSide.AWAY ? game.awaySportEventParticipantId : null;
  return winner === pick.sportEventParticipantId ? SurvivorWeekOutcome.SURVIVED : SurvivorWeekOutcome.ELIMINATED;
}

/** The entry's season so far, its weeks in week order. */
export function survivorRun(weeks: readonly SurvivorWeek[]): SurvivorRun {
  const results: SurvivorWeekResult[] = [];
  const usedParticipantIds = new Set<string>();
  let eliminatedAt: number | null = null;
  let weeksSurvived = 0;
  for (const week of weeks) {
    if (eliminatedAt !== null || week.cancelled) {
      results.push({ sportEventId: week.sportEventId, outcome: null });
      continue;
    }
    if (week.submitted && week.pickedParticipantId !== null) {
      usedParticipantIds.add(week.pickedParticipantId);
    }
    let outcome: SurvivorWeekOutcome | null;
    if (!week.started) {
      outcome = null;
    } else if (!week.submitted || week.pick === null) {
      outcome = SurvivorWeekOutcome.ELIMINATED;
    } else {
      outcome = survivorPickOutcome(week.games, week.pick);
    }
    if (outcome === SurvivorWeekOutcome.SURVIVED) weeksSurvived += 1;
    if (outcome === SurvivorWeekOutcome.ELIMINATED) eliminatedAt = results.length;
    results.push({ sportEventId: week.sportEventId, outcome });
  }
  return { weeks: results, eliminatedAt, weeksSurvived, usedParticipantIds };
}
