import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { SegmentedControl, Tile } from '@/features/shared/ui';

/** The contest pages a member moves between. */
export type ContestView = 'entries' | 'leaderboard' | 'my-entry';

/**
 * Entries, Leaderboard and My entry for one contest. Leaderboard appears once picks are revealed,
 * because its endpoint refuses before then; My entry appears once the viewer's team has one.
 */
export function ContestSubMenu({
  contestId,
  current,
  leagueCode,
  myEntryId,
  picksRevealed,
}: {
  contestId: string;
  /** The page being shown, or null on a page none of the options names (another team's entry). */
  current: ContestView | null;
  leagueCode: string;
  myEntryId: string | null;
  picksRevealed: boolean;
}) {
  const navigate = useNavigate();
  const paths: Partial<Record<ContestView, string>> = {
    entries: buildLeagueContestPath(leagueCode, contestId),
    ...(picksRevealed ? { leaderboard: buildLeagueContestLeaderboardPath(leagueCode, contestId) } : {}),
    ...(myEntryId ? { 'my-entry': buildLeagueContestEntryPath(leagueCode, contestId, myEntryId) } : {}),
  };
  const labels: Record<ContestView, string> = {
    entries: 'Entries',
    leaderboard: 'Leaderboard',
    'my-entry': 'My entry',
  };
  const views = (['entries', 'leaderboard', 'my-entry'] as const).filter((view) => paths[view] !== undefined);

  return (
    <nav aria-label="Contest pages" data-testid="contest-menu">
      <SegmentedControl
        aria-label="Contest page"
        onChange={(next) => {
          const path = paths[next as ContestView];
          if (path) {
            navigate(path, { state: { leagueCode } });
          }
        }}
        options={views.map((view) => ({ label: labels[view], testId: `contest-menu-${view}`, value: view }))}
        value={current ?? ''}
      />
    </nav>
  );
}

/**
 * The header every contest page shares: badges, a title and a summary line on the left, the
 * page's own actions on the right, and the contest sub-menu underneath.
 */
export function ContestHeader({
  actions,
  badges,
  children,
  menu,
  summary,
  title,
  titleTestId,
}: {
  actions?: ReactNode;
  badges: ReactNode;
  /** Anything the page shows under the title, such as its schedule or counts. */
  children?: ReactNode;
  menu: ReactNode;
  summary?: ReactNode;
  title: string;
  titleTestId: string;
}) {
  return (
    <Tile padding="lg">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">{badges}</div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight" data-testid={titleTestId}>
              {title}
            </h2>
            {summary}
            {children}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
      {menu ? <div className="mt-5">{menu}</div> : null}
    </Tile>
  );
}
