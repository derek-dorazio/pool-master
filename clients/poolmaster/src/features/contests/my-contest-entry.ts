import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, ContestEntryPlaceDto } from '@/lib/api';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { currentContestEvent, entryEventStatus } from './contest-events';
import { areContestEntriesOpen } from './contest-status';
import { listedContestStartsAt } from './use-contest-schedule';

/** Whether the viewer's entries in the current contests are known yet. */
export type MyEntriesState = 'loading' | 'failed' | 'ready';

const ENTRY_STATE_NOTE = {
  failed: "We couldn't check your entry.",
  loading: 'Checking your entry...',
} as const;

/** The pick screen of one of the viewer's entries: Edit picks once submitted, Finish your picks before. */
export type EntryEditStep = { label: 'Edit picks' | 'Finish your picks'; to: string };

/**
 * The viewer's next step in one current contest (#1763), as League Home's row offers it:
 * - `start`: not entered and open, Make your picks starts an entry on its pick screen (#1739)
 * - `entered`: in it and open, Edit picks (or Finish your picks), and Add entry unless it is full
 * - `full`: open but full and not entered; its commissioners can expand it
 * - `standing`: live, the place of the viewer's best entry when they have one
 * - `none`: set up, or closed and not yet live, so nothing to do here
 * - `note`: the viewer can't act yet: no team, or their entries are still loading or failed
 */
export type ContestNextStep =
  | { kind: 'start' }
  | { kind: 'entered'; canAddEntry: boolean; edit: EntryEditStep }
  | { kind: 'full' }
  | { kind: 'standing'; place: ContestEntryPlaceDto | null }
  | { kind: 'none' }
  | { kind: 'note'; note: string };

/**
 * Whether a contest has no room for another entry: its cap counts every team's entries, drafts
 * too (#947, #987). `entryCount` is the count the caller has; a list row has only the submitted
 * entries, which is enough to know a contest is full once they reach the cap.
 */
export function isContestFull(contest: Pick<ContestDto, 'entriesPerContest'>, entryCount: number): boolean {
  return contest.entriesPerContest !== null && entryCount >= contest.entriesPerContest;
}

/**
 * The count a contest's cap is checked against: every entry when the read carries it (a single
 * contest's read), else the submitted ones (a list row), whichever is more.
 */
export function contestCapacityCount(contest: Pick<ContestDto, 'allEntryCount' | 'entryCount'>): number {
  return Math.max(contest.allEntryCount ?? 0, contest.entryCount ?? 0);
}

/**
 * Where an entered viewer edits: their one entry's pick screen, or the contest page, where each
 * of their entries has its ✎, when they have more than one (#1763).
 */
function describeEditStep(leagueCode: string, contest: ContestDto, myEntries: readonly ContestEntryDto[], now: Date): EntryEditStep {
  // A contest of several events asks for picks event by event: this is about the current one.
  const currentEventId = currentContestEvent(contest, now)?.sportEventId;
  const isSubmitted = (entry: ContestEntryDto) => entryEventStatus(entry, currentEventId) === ContestEntryStatus.SUBMITTED;
  const label = myEntries.some(isSubmitted) ? 'Edit picks' : 'Finish your picks';
  const onlyEntry = myEntries.length === 1 ? myEntries[0] : undefined;
  return {
    label,
    to: onlyEntry
      ? buildLeagueContestEntryPath(leagueCode, contest.id, onlyEntry.id)
      : buildLeagueContestPath(leagueCode, contest.id),
  };
}

/** What the viewer can do next in a current contest, from their team's entries in it. */
export function describeContestNextStep({
  bestPlace,
  contest,
  entriesState,
  hasTeam,
  leagueCode,
  myEntries,
  now = new Date(),
}: {
  bestPlace: ContestEntryPlaceDto | undefined;
  contest: ContestDto;
  entriesState: MyEntriesState;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: readonly ContestEntryDto[] | undefined;
  now?: Date;
}): ContestNextStep {
  if (contest.status === ContestStatus.ACTIVE) {
    return { kind: 'standing', place: bestPlace ?? null };
  }
  if (!areContestEntriesOpen(contest, listedContestStartsAt(contest), now)) {
    return { kind: 'none' };
  }
  if (!hasTeam) {
    return { kind: 'note', note: 'Create your team to enter.' };
  }
  // Until the entries are known, offering to make picks could start a second entry.
  if (entriesState !== 'ready') {
    return { kind: 'note', note: ENTRY_STATE_NOTE[entriesState] };
  }
  const isFull = isContestFull(contest, contestCapacityCount(contest));
  if (myEntries?.length) {
    return { kind: 'entered', canAddEntry: !isFull, edit: describeEditStep(leagueCode, contest, myEntries, now) };
  }
  return isFull ? { kind: 'full' } : { kind: 'start' };
}
