/**
 * Survivor (#719, plans/knockout-and-pickem-design.md §5.5): one entry's season of weekly picks,
 * read in week order. A "week" is one round of one of the contest's events: a regular-season week
 * is an event of one round, and a playoff bracket's rounds are each a week of their own (#785), so
 * a playoff survivor pool picks one team per round. The pure rules, all here:
 *
 * - **Each week** the entry picks one team to win. It survives the week when that team wins, and
 *   when its game is cancelled (the entry did nothing wrong).
 * - **It loses a life** with a loss, a tie (no winner, as in pick'em), or a week that started with
 *   no submitted pick, and **it is out** when that was its last (#1754): a contest gives each
 *   entry one life, or two. A week that costs a life the entry keeps playing with is LIFE_LOST.
 *   Once out it plays no later week, whatever it picked there. A playoff round that starts with
 *   no pick costs a life too, as does running out of unused teams.
 * - **Each team once:** a team picked in a week the entry submitted is used for the rest of the
 *   season, by its participant, since each week has its own field rows. When the contest lets
 *   teams be picked again once every team is used (#787), the season runs in cycles: each team
 *   once a cycle, and a cycle ends when the entry has used every team (`survivorTeamsUsedInCycle`).
 * - **The score** is the weeks survived: entries out in the same week tie, and entries still
 *   standing at the end with the same lives left share the win.
 */
import { MatchStatus, SurvivorWeekOutcome, winnerParticipantId, type SportEventRoundMatch } from '@poolmaster/shared/domain';

/** One week of the entry's season, as its read sees it. */
export interface SurvivorWeek {
  sportEventId: string;
  /** The round of the event the week is: 1 for a regular-season week, which has one. */
  roundNumber: number;
  /** Whether the week's first game has kicked off: a week not started decides nothing yet. */
  started: boolean;
  /** The week was cancelled: it counts for nothing, so nobody is out for it. */
  cancelled: boolean;
  /** Whether the entry submitted the week's event: a playoff is submitted once, for all its rounds. */
  submitted: boolean;
  /** The week's games, cancelled ones included: a pick on a cancelled game survives. */
  games: readonly SportEventRoundMatch[];
  /** The entry's pick in the week, when it has one: the game and the team's field row. */
  pick: { sportEventRoundMatchId: string; sportEventParticipantId: string } | null;
  /** The picked team's participant, which "each team once" is checked on. */
  pickedParticipantId: string | null;
}

/** The entry's outcome for one week, or null for a week it no longer plays or that decides nothing. */
export interface SurvivorWeekResult {
  sportEventId: string;
  roundNumber: number;
  outcome: SurvivorWeekOutcome | null;
}

export interface SurvivorRun {
  weeks: SurvivorWeekResult[];
  /** The index in `weeks` of the week that put the entry out; null while it is still standing. */
  eliminatedAt: number | null;
  /** How many weeks the entry survived: its score. */
  weeksSurvived: number;
  /** The weeks that cost the entry a life, the one that put it out included. */
  livesLost: number;
  /** The lives the entry has left: 0 once it is out. */
  livesLeft: number;
  /** The participants the entry picked in the weeks it submitted, before it went out. */
  usedParticipantIds: Set<string>;
}

/** How a submitted pick stands against its game. */
export function survivorPickOutcome(
  games: readonly SportEventRoundMatch[],
  pick: { sportEventRoundMatchId: string; sportEventParticipantId: string },
): SurvivorWeekOutcome {
  const game = games.find((candidate) => candidate.id === pick.sportEventRoundMatchId);
  // A pick on a game no longer in the week (moved away before release) has nothing to lose.
  if (!game || game.status === MatchStatus.CANCELLED) return SurvivorWeekOutcome.SURVIVED;
  if (game.status !== MatchStatus.COMPLETED) return SurvivorWeekOutcome.PENDING;
  const winner = winnerParticipantId(game);
  return winner === pick.sportEventParticipantId ? SurvivorWeekOutcome.SURVIVED : SurvivorWeekOutcome.ELIMINATED;
}

/** The entry's season so far, its weeks in week order, with the contest's `lives` (`survivorLivesOf`). */
export function survivorRun(weeks: readonly SurvivorWeek[], lives: number): SurvivorRun {
  const results: SurvivorWeekResult[] = [];
  const usedParticipantIds = new Set<string>();
  let eliminatedAt: number | null = null;
  let weeksSurvived = 0;
  let livesLost = 0;
  for (const week of weeks) {
    if (eliminatedAt !== null || week.cancelled) {
      results.push({ sportEventId: week.sportEventId, roundNumber: week.roundNumber, outcome: null });
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
    if (outcome === SurvivorWeekOutcome.ELIMINATED) {
      livesLost += 1;
      if (livesLost < lives) {
        outcome = SurvivorWeekOutcome.LIFE_LOST;
      } else {
        eliminatedAt = results.length;
      }
    }
    results.push({ sportEventId: week.sportEventId, roundNumber: week.roundNumber, outcome });
  }
  return { weeks: results, eliminatedAt, weeksSurvived, livesLost, livesLeft: Math.max(lives - livesLost, 0), usedParticipantIds };
}

/**
 * The teams an entry has used, by participant, around one of its weeks: what that week's pick may
 * not repeat (#787). `picks` holds each week's picked participant in week order, null for a week
 * with none that counts (not submitted, or cancelled); the week at `weekIndex` is the one being
 * picked, and its own pick is left out. With `teamCount` null each team is used once all season,
 * so every other week's pick counts. Otherwise the weeks run in cycles, the week being picked
 * taking one place in its cycle: a cycle ends once it holds `teamCount` teams, and only the picks
 * of the week's own cycle, before it or picked ahead after it, count. Each used team maps to the
 * index of the week it was picked in, so the pick screen can say when (#1757).
 */
export function survivorTeamsUsedInCycle(
  picks: readonly (string | null)[],
  weekIndex: number,
  teamCount: number | null,
): Map<string, number> {
  if (teamCount === null) {
    return new Map(picks.flatMap((pick, index) => (index !== weekIndex && pick !== null ? [[pick, index] as const] : [])));
  }
  let cycle = new Map<string, number>();
  let holdsWeek = false;
  for (const [index, pick] of picks.entries()) {
    if (index === weekIndex) {
      holdsWeek = true;
    } else if (pick !== null) {
      cycle.set(pick, index);
    } else {
      continue;
    }
    if (cycle.size + (holdsWeek ? 1 : 0) >= teamCount) {
      if (holdsWeek) return cycle;
      cycle = new Map<string, number>();
    }
  }
  return cycle;
}
