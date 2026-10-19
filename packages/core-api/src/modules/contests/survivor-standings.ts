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
  SportEventMatchRepository,
  SportEventRepository,
} from '@poolmaster/shared/db';
import {
  ContestEntryStatus,
  SportEventStatus,
  contestEntryEventStatus,
  hasSubmittedAnyEvent,
  type Contest,
  type ContestEntry,
  type SportEvent,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import { hasSportEventStarted } from '../events/operational-timing';
import { survivorRun, type SurvivorRun, type SurvivorWeek } from '../scoring-families/head-to-head/survivor';

export interface SurvivorStandingsReadDeps {
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  entries: Pick<ContestEntryRepository, 'findByContestWithSquad'>;
  predictions: Pick<ContestEntryMatchPredictionRepository, 'findByEntriesAndEvents'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvents'>;
}

/** One week of the season: its event, its place in the season and its games, cancelled ones included. */
export interface SurvivorSeasonWeek {
  event: SportEvent;
  /** 1 for the contest's first week. */
  weekNumber: number;
  /** Whether its first game has kicked off: picks lock then, and a week not started decides nothing. */
  started: boolean;
  /** A cancelled week counts for nothing (#743): nobody is out for it. */
  cancelled: boolean;
  games: SportEventMatch[];
}

export interface SurvivorEntryStanding {
  entry: ContestEntryWithSquad;
  run: SurvivorRun;
  /** The entry's pick in each week, by event. */
  picks: Map<string, ContestEntrySeasonPrediction>;
  /** Still standing: entries out in the same week share a place, below every entry still in. */
  alive: boolean;
  position: number;
  displayPosition: string;
}

export interface SurvivorSeasonStandings {
  weeks: SurvivorSeasonWeek[];
  /** Ranked, best first: every entry that submitted a week. */
  entries: SurvivorEntryStanding[];
}

/** The contest's weeks, in start order, with their games. */
export async function loadSurvivorWeeks(
  deps: Pick<SurvivorStandingsReadDeps, 'sportEvents' | 'matches'>,
  contest: Pick<Contest, 'sportEventIds'>,
  now: Date,
): Promise<SurvivorSeasonWeek[]> {
  const [events, matches] = await Promise.all([
    deps.sportEvents.findByIds(contest.sportEventIds),
    deps.matches.findBySportEvents(contest.sportEventIds),
  ]);
  return [...events]
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime() || left.id.localeCompare(right.id))
    .map((event, index) => ({
      event,
      weekNumber: index + 1,
      started: hasSportEventStarted(event, now),
      cancelled: event.status === SportEventStatus.CANCELLED,
      games: matches.filter((match) => match.sportEventId === event.id),
    }));
}

/** The entry's weeks as its run reads them, from its picks across the season. */
export function survivorWeeksOf(
  entry: Pick<ContestEntry, 'events'>,
  weeks: readonly SurvivorSeasonWeek[],
  picks: ReadonlyMap<string, ContestEntrySeasonPrediction>,
): SurvivorWeek[] {
  return weeks.map(({ event, started, cancelled, games }) => {
    const pick = picks.get(event.id) ?? null;
    return {
      sportEventId: event.id,
      started,
      cancelled,
      submitted: contestEntryEventStatus(entry, event.id) === ContestEntryStatus.SUBMITTED,
      games,
      pick,
      pickedParticipantId: pick?.participantId ?? null,
    };
  });
}

/** Each entry's pick per event: a survivor week holds one. */
export function survivorPicksByEntry(predictions: readonly ContestEntrySeasonPrediction[]): Map<string, Map<string, ContestEntrySeasonPrediction>> {
  const byEntry = new Map<string, Map<string, ContestEntrySeasonPrediction>>();
  for (const prediction of predictions) {
    const picks = byEntry.get(prediction.contestEntryId) ?? new Map<string, ContestEntrySeasonPrediction>();
    picks.set(prediction.sportEventId, prediction);
    byEntry.set(prediction.contestEntryId, picks);
  }
  return byEntry;
}

/**
 * The season so far: every entry that submitted a week, run through the weeks and ranked, entries
 * still standing first, then by weeks survived. Entries that tie share a place.
 */
export async function loadSurvivorSeason(
  deps: SurvivorStandingsReadDeps,
  contest: Pick<Contest, 'id' | 'sportEventIds'>,
  now: Date,
): Promise<SurvivorSeasonStandings> {
  const [weeks, entries] = await Promise.all([
    loadSurvivorWeeks(deps, contest, now),
    deps.entries.findByContestWithSquad(contest.id),
  ]);
  const counted = entries.filter(hasSubmittedAnyEvent);
  const predictions = await deps.predictions.findByEntriesAndEvents(counted.map((entry) => entry.id), contest.sportEventIds);
  const picksByEntry = survivorPicksByEntry(predictions);

  const runs = counted.map((entry) => {
    const picks = picksByEntry.get(entry.id) ?? new Map<string, ContestEntrySeasonPrediction>();
    const run = survivorRun(survivorWeeksOf(entry, weeks, picks));
    return { entry, run, picks, alive: run.eliminatedAt === null };
  });
  const rankKey = (standing: { alive: boolean; run: SurvivorRun }) => `${standing.alive ? 1 : 0}:${standing.run.weeksSurvived}`;
  const better = (left: (typeof runs)[number], right: (typeof runs)[number]) =>
    Number(right.alive) - Number(left.alive) || right.run.weeksSurvived - left.run.weeksSurvived;
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
