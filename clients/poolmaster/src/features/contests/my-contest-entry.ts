import type { ContestDto, ContestEntryDto } from '@/lib/api';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import { currentContestEvent, entryEventStatus } from './contest-events';

/** Whether the viewer's entries in the current contests are known yet. */
export type MyEntriesState = 'loading' | 'failed' | 'ready';

const ENTRY_STATE_NOTE = {
  failed: "We couldn't check your entry.",
  loading: 'Checking your entry...',
} as const;

/**
 * The viewer's next step in a contest: a link to go to, or `start` for a new entry, which the
 * button creates and opens on its pick screen (#1739), never the contest page.
 */
export type MyEntryNextStep =
  | { kind: 'link'; label: string; note: string; to: string }
  | { kind: 'start'; label: string; note: string };

/** What the viewer's entries in a contest mean for them, and where to go next. */
export function describeMyEntry(
  leagueCode: string,
  contest: ContestDto,
  myEntries: readonly ContestEntryDto[] | undefined,
  entriesState: MyEntriesState,
  hasTeam: boolean,
): MyEntryNextStep {
  const contestPath = buildLeagueContestPath(leagueCode, contest.id);
  if (!hasTeam) {
    return { kind: 'link', label: 'View contest', note: 'Create your team to enter.', to: contestPath };
  }
  // Until the entries are known, offering to make picks could start a second entry.
  if (entriesState !== 'ready') {
    return { kind: 'link', label: 'View contest', note: ENTRY_STATE_NOTE[entriesState], to: contestPath };
  }
  // A contest of several events asks for picks event by event: this is about the current one.
  const currentEventId = currentContestEvent(contest)?.sportEventId;
  const submitted = myEntries?.find((entry) => entryEventStatus(entry, currentEventId) === ContestEntryStatus.SUBMITTED);
  if (submitted) {
    return {
      kind: 'link',
      label: 'Edit picks',
      note: 'Your entry is submitted.',
      to: buildLeagueContestEntryPath(leagueCode, contest.id, submitted.id),
    };
  }
  const draft = myEntries?.[0];
  if (draft) {
    return {
      kind: 'link',
      label: 'Finish your picks',
      note: 'Your entry is not submitted yet.',
      to: buildLeagueContestEntryPath(leagueCode, contest.id, draft.id),
    };
  }
  return { kind: 'start', label: 'Make your picks', note: 'You have not entered yet.' };
}
