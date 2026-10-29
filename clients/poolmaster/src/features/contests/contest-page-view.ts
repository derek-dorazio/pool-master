import type { ContestDto } from '@/lib/api';

/** The contest pages a member moves between. */
export type ContestView = 'entries' | 'leaderboard' | 'my-entry';

/** Which sub-menu option an entry's page is: My entry for the viewer's own, none for another team's. */
export function entryPageView(contest: Pick<ContestDto, 'myEntryIds'>, entryId: string): ContestView | null {
  return contest.myEntryIds?.includes(entryId) ? 'my-entry' : null;
}
