/**
 * A survivor contest's season (#719): its weeks in order, and each entry's run through them, who is
 * still standing and the weeks each survived. One read for the live leaderboard and for
 * settlement, so the two cannot drift apart, as pick-em-standings.ts is for pick'em. The rules of
 * a run are in survivor.ts in the head-to-head family; picking a week reads the same weeks
 * through `survivorWeeksOf`.
 */
import type {
  ContestEntryMatchPredictionRepository,
  ContestEntryRepository,
  ContestEntrySeasonPrediction,
  ContestEntryWithSquad,
  SportEventRoundMatchRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  MatchStatus,
  SportEventStatus,
  contestEntryEventStatus,
  hasSubmittedAnyEvent,
  isTeamChoice,
  type Contest,
  type ContestEntry,
  type SportEvent,
  type SportEventRoundMatch,
  type TeamChoice,
  hasSportEventStarted,
  isSportEventStatusFinished,
} from '@poolmaster/shared/domain';
import { hasRoundMatchStarted } from './entry-window';
import { survivorRun, type SurvivorRun, type SurvivorWeek } from '../scoring-families/head-to-head/survivor';

export interface SurvivorStandingsReadDeps {
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  entries: Pick<ContestEntryRepository, 'findByContestWithSquad'>;
  predictions: Pick<ContestEntryMatchPredictionRepository, 'findByEntriesAndEvents'>;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvents'>;
}

/**
 * One week of the season: a round of one of its events, its place in the season and the round's
 * games, cancelled ones included. A regular-season week is an event of one round; a playoff
 * bracket's rounds are each a week (#785).
 */
export interface SurvivorSeasonWeek {
  event: SportEvent;
  roundNumber: number;
  /** The event's rounds, for its round labels. */
  roundCount: number;
  /** 1 for the contest's first week. */
  weekNumber: number;
  /**
   * Whether its first game has kicked off: picks lock then, and a week not started decides
   * nothing. An event's first round starts with the event, so its submit closes then; a later
   * round at its own first game.
   */
  started: boolean;
  /** A cancelled week counts for nothing (#743): nobody is out for it. */
  cancelled: boolean;
  games: SportEventRoundMatch[];
}

export interface SurvivorEntryStanding {
  entry: ContestEntryWithSquad;
  run: SurvivorRun;
  /** The entry's pick in each week, by week key (`survivorWeekKey`). */
  picks: Map<string, SurvivorSeasonPick>;
  /**
   * Still standing: entries out in the same week share a place, below every entry still in.
   * Entries still in rank by lives left (#1754), then weeks survived.
   */
  alive: boolean;
  position: number;
  displayPosition: string;
}

export interface SurvivorSeasonStandings {
  weeks: SurvivorSeasonWeek[];
  /** Ranked, best first: every entry that submitted a week. */
  entries: SurvivorEntryStanding[];
}

/** A week's key: its event and round. */
export function survivorWeekKey(week: { sportEventId: string; roundNumber: number }): string {
  return `${week.sportEventId}:${week.roundNumber}`;
}

/**
 * The contest's weeks, in start order, with their games: each event's rounds in round order. A
 * caller that already holds one event and its matches passes them in, and only the other events
 * are read (#1201).
 */
export async function loadSurvivorWeeks(
  deps: Pick<SurvivorStandingsReadDeps, 'sportEvents' | 'matches'>,
  contest: Pick<Contest, 'sportEventIds'>,
  now: Date,
  loaded?: { sportEvent: SportEvent; matches: readonly SportEventRoundMatch[] },
): Promise<SurvivorSeasonWeek[]> {
  const otherIds = contest.sportEventIds.filter((id) => id !== loaded?.sportEvent.id);
  const [otherEvents, otherMatches] = otherIds.length === 0
    ? [[], []]
    : await Promise.all([
      deps.sportEvents.findByIds(otherIds),
      deps.matches.findBySportEvents(otherIds),
    ]);
  const own = loaded && contest.sportEventIds.includes(loaded.sportEvent.id) ? loaded : undefined;
  const events = own ? [...otherEvents, own.sportEvent] : otherEvents;
  const matches = own ? [...otherMatches, ...own.matches] : otherMatches;
  const ordered = [...events]
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime() || left.id.localeCompare(right.id));
  const weeks: Omit<SurvivorSeasonWeek, 'weekNumber'>[] = ordered.flatMap((event) => {
    const games = matches.filter((match) => match.sportEventId === event.id);
    const roundNumbers = [...new Set(games.map((match) => match.roundNumber))].sort((left, right) => left - right);
    const firstRound = roundNumbers.at(0) ?? 1;
    const cancelled = event.status === SportEventStatus.CANCELLED;
    return (roundNumbers.length > 0 ? roundNumbers : [firstRound]).map((roundNumber) => ({
      event,
      roundNumber,
      roundCount: Math.max(event.roundCount, roundNumbers.at(-1) ?? 1),
      // A later round starts at its first game's kickoff; its games with no time yet wait on theirs (#785).
      started: roundNumber === firstRound
        ? hasSportEventStarted(event, now)
        : isSportEventStatusFinished(event.status)
          || games.some((match) => match.roundNumber === roundNumber && match.status !== MatchStatus.CANCELLED && hasRoundMatchStarted(match, event, firstRound, now)),
      cancelled,
      games: games.filter((match) => match.roundNumber === roundNumber),
    }));
  });
  return weeks.map((week, index) => ({ ...week, weekNumber: index + 1 }));
}

/** The entry's weeks as its run reads them, from its picks across the season. */
export function survivorWeeksOf(
  entry: Pick<ContestEntry, 'events'>,
  weeks: readonly SurvivorSeasonWeek[],
  picks: ReadonlyMap<string, SurvivorSeasonPick>,
): SurvivorWeek[] {
  return weeks.map(({ event, roundNumber, started, cancelled, games }) => {
    const pick = picks.get(survivorWeekKey({ sportEventId: event.id, roundNumber })) ?? null;
    return {
      sportEventId: event.id,
      roundNumber,
      started,
      cancelled,
      submitted: contestEntryEventStatus(entry, event.id) === ContestEntryStatus.SUBMITTED,
      games,
      pick,
      pickedParticipantId: pick?.participantId ?? null,
    };
  });
}

/** Each entry's pick per week, by week key: a survivor week holds one. A pick on a game no week has is left out. */
/** A survivor pick read across the season: always a team (#792), so it names its participant. */
export type SurvivorSeasonPick = ContestEntrySeasonPrediction & TeamChoice;

export function survivorPicksByEntry(
  predictions: readonly ContestEntrySeasonPrediction[],
  weeks: readonly SurvivorSeasonWeek[],
): Map<string, Map<string, SurvivorSeasonPick>> {
  const weekOfGame = new Map(weeks.flatMap((week) => week.games.map((game) => [game.id, survivorWeekKey({ sportEventId: week.event.id, roundNumber: week.roundNumber })] as const)));
  const byEntry = new Map<string, Map<string, SurvivorSeasonPick>>();
  for (const prediction of predictions.filter(isTeamChoice)) {
    const key = weekOfGame.get(prediction.sportEventRoundMatchId);
    if (key === undefined) continue;
    const picks = byEntry.get(prediction.contestEntryId) ?? new Map<string, SurvivorSeasonPick>();
    picks.set(key, prediction);
    byEntry.set(prediction.contestEntryId, picks);
  }
  return byEntry;
}

/**
 * The season so far: every entry that submitted a week, run through the weeks with the contest's
 * `lives` (`survivorLivesOf`, #1754) and ranked: entries still standing first, then more lives
 * left, then more weeks survived. Entries out have no life left, and the one out later survived
 * more weeks. Entries that tie share a place.
 */
export async function loadSurvivorSeason(
  deps: SurvivorStandingsReadDeps,
  contest: Pick<Contest, 'id' | 'sportEventIds'>,
  now: Date,
  lives: number,
): Promise<SurvivorSeasonStandings> {
  const [weeks, entries] = await Promise.all([
    loadSurvivorWeeks(deps, contest, now),
    deps.entries.findByContestWithSquad(contest.id),
  ]);
  const counted = entries.filter(hasSubmittedAnyEvent);
  const predictions = await deps.predictions.findByEntriesAndEvents(counted.map((entry) => entry.id), contest.sportEventIds);
  const picksByEntry = survivorPicksByEntry(predictions, weeks);

  const runs = counted.map((entry) => {
    const picks = picksByEntry.get(entry.id) ?? new Map<string, SurvivorSeasonPick>();
    const run = survivorRun(survivorWeeksOf(entry, weeks, picks), lives);
    return { entry, run, picks, alive: run.eliminatedAt === null };
  });
  const rankKey = (standing: { alive: boolean; run: SurvivorRun }) => `${standing.alive ? 1 : 0}:${standing.run.livesLeft}:${standing.run.weeksSurvived}`;
  const better = (left: (typeof runs)[number], right: (typeof runs)[number]) =>
    Number(right.alive) - Number(left.alive)
    || right.run.livesLeft - left.run.livesLeft
    || right.run.weeksSurvived - left.run.weeksSurvived;
  const ordered = [...runs].sort((left, right) =>
    better(left, right) || left.entry.entryNumber - right.entry.entryNumber || left.entry.name.localeCompare(right.entry.name));
  const sharing = new Map<string, number>();
  for (const standing of ordered) sharing.set(rankKey(standing), (sharing.get(rankKey(standing)) ?? 0) + 1);

  let position = 0;
  let previousKey: string | null = null;
  const ranked = ordered.map((standing, index) => {
    const key = rankKey(standing);
    if (key !== previousKey) position = index + 1;
    previousKey = key;
    const tied = (sharing.get(key) ?? 0) > 1;
    return { ...standing, position, displayPosition: tied ? `T${position}` : String(position) };
  });
  return { weeks, entries: ranked };
}
