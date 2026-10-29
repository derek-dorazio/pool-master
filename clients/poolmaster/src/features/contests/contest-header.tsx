import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  buildLeagueContestEntryPath,
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { Heading, LinkButton, SegmentedControl, Tile } from '@/features/shared/ui';
import type { ContestView } from './contest-page-view';
import { ContestStatusBadge } from './contest-status-badge';


/**
 * Entries, Leaderboard and My entry for one contest. Leaderboard appears once picks are revealed,
 * because its endpoint refuses before then; My entry appears once the viewer's team has one.
 */
function ContestSubMenu({
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
            void navigate(path, { state: { leagueCode } });
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
function ContestHeader({
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
            <Heading data-testid={titleTestId} level={2} tone="inherit" variant="page">
              {title}
            </Heading>
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

/**
 * Every contest page's frame: the header with the contest's status badge, name and the
 * Entries / Leaderboard / My entry sub-menu built from the contest, then the page's body. The
 * sub-menu shows only when the league is known, since its paths are the league's.
 */
export function ContestPageFrame({
  actions,
  badges,
  children,
  contest,
  current,
  details,
  leagueCode,
  picksRevealed,
  summary,
  testId,
  title,
  titleTestId,
}: {
  actions?: ReactNode;
  /** The header's badges; the contest's status badge unless the page says more. */
  badges?: ReactNode;
  /** The page's body, under the header. */
  children?: ReactNode;
  contest: Pick<ContestDto, 'id' | 'myEntryIds' | 'name' | 'status'>;
  current: ContestView | null;
  /** Anything the header shows under the title and summary, such as a schedule or notes. */
  details?: ReactNode;
  leagueCode: string | null;
  /** Whether the Leaderboard option shows: its endpoint refuses until picks are revealed. */
  picksRevealed: boolean;
  summary?: ReactNode;
  testId?: string;
  /** The heading; the contest's name unless the page is about one entry. */
  title?: string;
  titleTestId: string;
}) {
  return (
    <section className="space-y-6" data-testid={testId}>
      <ContestHeader
        actions={actions}
        badges={badges ?? <ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contest.id}
            current={current}
            leagueCode={leagueCode}
            myEntryId={contest.myEntryIds?.[0] ?? null}
            picksRevealed={picksRevealed}
          />
        ) : null}
        summary={summary}
        title={title ?? contest.name}
        titleTestId={titleTestId}
      >
        {details}
      </ContestHeader>
      {children}
    </section>
  );
}

/**
 * An entry page's way back: to its league, and to the contest too when the league is not known
 * (with the league known, the sub-menu's Entries is the way to the contest).
 */
export function ContestEntryBackLinks({ contestId, leagueCode }: { contestId: string; leagueCode: string | null }) {
  return (
    <>
      {leagueCode ? null : (
        <LinkButton data-testid="contest-entry-back-to-contest" to={`/contests/${contestId}`} variant="secondary">
          Back to contest
        </LinkButton>
      )}
      <LinkButton
        data-testid="contest-entry-back-to-league"
        to={leagueCode ? buildLeaguePath(leagueCode) : '/welcome'}
        variant="secondary"
      >
        Back to league
      </LinkButton>
    </>
  );
}
