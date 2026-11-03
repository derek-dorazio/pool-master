import type { ContestDto } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';

/** The contest pages a member moves between. */
export type ContestView = 'entries' | 'leaderboard' | 'my-entry';

/**
 * Which sub-menu option an entry's page is: My entry for the viewer's only entry, none for
 * another team's. With two or more of their own, My entries is their list, not one entry (#1392).
 */
export function entryPageView(contest: Pick<ContestDto, 'myEntryIds'>, entryId: string): ContestView | null {
  const myEntryIds = contest.myEntryIds ?? [];
  return myEntryIds.length === 1 && myEntryIds[0] === entryId ? 'my-entry' : null;
}

/** The search a contest's Entries page reads to show only the viewer's own entries (#1392). */
export const MY_ENTRIES_PARAM = 'mine';

/** A contest's Entries page showing only the viewer's own entries: My entries with two or more. */
export function buildMyContestEntriesPath(leagueCode: string, contestId: string) {
  return `${buildLeagueContestPath(leagueCode, contestId)}?${MY_ENTRIES_PARAM}=1`;
}
