/**
 * What the contest leaderboard and golf settlement both read, on ports (#247): the event's field,
 * the contest's counting and scoring configuration, and its active entries with their picks. One
 * set of reads for both, so the live leaderboard and the settled result cannot drift apart.
 */
import type {
  ContestConfigurationRepository,
  ContestEntryPickRepository,
  ContestEntryRepository,
  ContestEntryWithSquad,
  ParticipantContestScoringRuleRepository,
} from '@poolmaster/shared/db';
import { ContestEntryStatus, contestEntryEventStatus, type Contest, type ContestScoringSettings } from '@poolmaster/shared/domain';
import type {
  SportEventParticipantService,
  SportEventParticipantView,
} from '../events/sport-event-participant-service';
import type {
  ContestLeaderboardEntryInput,
  ContestScoringConfigurationRow,
  ParticipantScore,
} from './contest-leaderboard-calculator';
import { scoringFamilyForEvent, type FieldScoringEvent } from '../scoring-families';

export interface ContestLeaderboardReadDeps {
  eventParticipants: Pick<SportEventParticipantService, 'listEventParticipants'>;
  configurations: ContestConfigurationRepository;
  scoringRules: ParticipantContestScoringRuleRepository;
  entries: ContestEntryRepository;
  picks: ContestEntryPickRepository;
}

/** The event's field, in seed order, as the event publishes it. */
export async function loadEventField(
  deps: Pick<ContestLeaderboardReadDeps, 'eventParticipants'>,
  sportEventId: string,
): Promise<SportEventParticipantView[]> {
  return deps.eventParticipants.listEventParticipants(sportEventId);
}

/**
 * Each field row's score under one contest's scoring definition and settings, from the scoring
 * family of the event's sport (#606). Per contest, because settings such as a points table
 * belong to the contest. A row the family cannot score yet is unscored.
 */
export function toParticipantScores(
  field: readonly SportEventParticipantView[],
  event: FieldScoringEvent,
  scoring: ContestScoringSettings,
): ParticipantScore[] {
  return scoringFamilyForEvent(event).scoreField(field, event, scoring);
}

/** What a lineup scores in an event its entry missed (#714), by the event's scoring family. */
export function scoreMissedLineup(
  field: readonly SportEventParticipantView[],
  event: FieldScoringEvent,
  scoring: ContestScoringSettings,
  countingPickLimit: number,
): number | null {
  return scoringFamilyForEvent(event).scoreMissedLineup(field, event, scoring, countingPickLimit);
}

/**
 * The contest's counting and scoring configuration, or null when it has none. Each scoring
 * rule arrives read through its definition's settings schema; `resolveContestScoringDefinition`
 * refuses one that failed it.
 */
export async function loadContestScoringConfiguration(
  deps: Pick<ContestLeaderboardReadDeps, 'configurations' | 'scoringRules'>,
  contestId: string,
): Promise<ContestScoringConfigurationRow | null> {
  const configuration = await deps.configurations.findByContest(contestId);
  if (!configuration) {
    return null;
  }
  const rules = await deps.scoringRules.findByContestConfiguration(configuration.id);
  return {
    configJson: configuration.configJson ?? null,
    participantScoringRules: rules.map((rule) => ({
      sortOrder: rule.sortOrder,
      scoring: rule.scoring,
      active: rule.active,
    })),
  };
}

/**
 * The entries of a contest of several events that did not submit a lineup for one of them (#714):
 * each is scored for that event as a missed lineup once it finishes. A one-event contest has
 * none: an entry that never submitted is simply not in it.
 */
export async function loadMissedEventEntries(
  deps: Pick<ContestLeaderboardReadDeps, 'entries'>,
  contest: Pick<Contest, 'id' | 'sportEventIds'>,
  submittedEntryIds: ReadonlySet<string>,
): Promise<ContestLeaderboardEntryInput[]> {
  if (contest.sportEventIds.length < 2) {
    return [];
  }
  const entries = await deps.entries.findByContestWithSquad(contest.id);
  return entries
    .filter((entry) => !submittedEntryIds.has(entry.id))
    .map((entry) => toLeaderboardEntryInput(entry, []));
}

/** A contest entry as the leaderboard reads it: its name, its squad, and its picks in one event. */
export function toLeaderboardEntryInput(
  entry: ContestEntryWithSquad,
  picks: ContestLeaderboardEntryInput['picks'],
): ContestLeaderboardEntryInput {
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    name: entry.name,
    squadId: entry.squadId,
    squad: { name: entry.squadName },
    picks,
  };
}

/**
 * The contest's entries that SUBMITTED one event, in entry order, each with its picks in that
 * event, in pick order (#713, #1162).
 */
export async function loadContestLeaderboardEntries(
  deps: Pick<ContestLeaderboardReadDeps, 'entries' | 'picks'>,
  contestId: string,
  sportEventId: string,
): Promise<ContestLeaderboardEntryInput[]> {
  const entries = await deps.entries.findByContestWithSquad(contestId, { submittedFor: sportEventId });
  const picks = await loadEventPicks(deps, entries.map((entry) => entry.id), [sportEventId]);
  return submittedLeaderboardEntries(entries, sportEventId, picks);
}

/** Each entry's picks in one event, by entry id, in pick order. */
export type EntryEventPicks = Map<string, ContestLeaderboardEntryInput['picks']>;

/**
 * The entries' picks in each of the events asked for, by event, in one read however many events
 * (#1162): an event not asked for loads none.
 */
export async function loadEventPicks(
  deps: Pick<ContestLeaderboardReadDeps, 'picks'>,
  entryIds: readonly string[],
  sportEventIds: readonly string[],
): Promise<Map<string, EntryEventPicks>> {
  const byEvent = new Map<string, EntryEventPicks>(sportEventIds.map((sportEventId) => [sportEventId, new Map()]));
  for (const pick of await deps.picks.findByEntriesAndEvents(entryIds, sportEventIds)) {
    const byEntry = byEvent.get(pick.sportEventId);
    if (!byEntry) continue;
    const list = byEntry.get(pick.entryId) ?? [];
    list.push({
      id: pick.id,
      sportEventParticipantId: pick.sportEventParticipantId,
      pickedAt: pick.pickedAt,
      slot: pick.slot ?? null,
    });
    byEntry.set(pick.entryId, list);
  }
  return byEvent;
}

/** Of the contest's entries, those that SUBMITTED the event, in the order given, each with its picks there. */
export function submittedLeaderboardEntries(
  entries: readonly ContestEntryWithSquad[],
  sportEventId: string,
  picks: ReadonlyMap<string, EntryEventPicks>,
): ContestLeaderboardEntryInput[] {
  const eventPicks = picks.get(sportEventId);
  return entries
    .filter((entry) => contestEntryEventStatus(entry, sportEventId) === ContestEntryStatus.SUBMITTED)
    .map((entry) => toLeaderboardEntryInput(entry, eventPicks?.get(entry.id) ?? []));
}
