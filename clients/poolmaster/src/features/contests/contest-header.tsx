import type { ReactNode } from 'react';
import type { ContestEntryStatus } from '@poolmaster/shared/domain';
import { useNavigate } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  buildContestLandingPath,
  buildContestsFocusPath,
  buildLeagueContestEntryPath,
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { Breadcrumbs, Heading, SegmentedControl, Tile } from '@/features/shared/ui';
import { buildMyContestEntriesPath, entryPageView, type ContestView } from './contest-page-view';
import { ContestStatusBadge } from './contest-status-badge';
import { EntryStatusCallout, type EntryStatusFact } from './entry-status-callout';

/** What a contest page's frame reads of its contest. */
type FramedContest = Pick<ContestDto, 'endsAt' | 'id' | 'leagueId' | 'myEntryIds' | 'name' | 'status'>;

/**
 * Leaderboard, Entries and My entry for one contest (#1392). Leaderboard appears once picks are
 * revealed, because its endpoint refuses before then. With one entry of the viewer's, My entry
 * opens it; with two or more, My entries opens Entries showing only theirs.
 */
function ContestSubMenu({
  contestId,
  current,
  leagueCode,
  myEntryIds,
  picksRevealed,
}: {
  contestId: string;
  /** The page being shown, or null on a page none of the options names (another team's entry). */
  current: ContestView | null;
  leagueCode: string;
  myEntryIds: readonly string[];
  picksRevealed: boolean;
}) {
  const navigate = useNavigate();
  const [onlyEntryId] = myEntryIds;
  const hasSeveral = myEntryIds.length > 1;
  const paths: Partial<Record<ContestView, string>> = {
    ...(picksRevealed ? { leaderboard: buildLeagueContestLeaderboardPath(leagueCode, contestId) } : {}),
    entries: buildLeagueContestPath(leagueCode, contestId),
    ...(hasSeveral
      ? { 'my-entry': buildMyContestEntriesPath(leagueCode, contestId) }
      : onlyEntryId ? { 'my-entry': buildLeagueContestEntryPath(leagueCode, contestId, onlyEntryId) } : {}),
  };
  const labels: Record<ContestView, string> = {
    entries: 'Entries',
    leaderboard: 'Leaderboard',
    'my-entry': hasSeveral ? 'My entries' : 'My entry',
  };
  const views = (['leaderboard', 'entries', 'my-entry'] as const).filter((view) => paths[view] !== undefined);

  return (
    <nav aria-label="Contest pages" data-testid="contest-menu">
      <SegmentedControl
        aria-label="Contest page"
        onChange={(next) => {
          const path = paths[next as ContestView];
          if (path) {
            void navigate(path);
          }
        }}
        options={views.map((view) => ({ label: labels[view], testId: `contest-menu-${view}`, value: view }))}
        value={current ?? ''}
      />
    </nav>
  );
}

/**
 * The header every contest page shares: the trail back to the league's contests, badges, a title with anything beside it and a summary
 * line on the left, the page's own actions on the right, and the contest sub-menu underneath.
 */
function ContestHeader({
  actions,
  badges,
  breadcrumbs,
  children,
  menu,
  summary,
  title,
  titleAside,
  titleTestId,
}: {
  actions?: ReactNode;
  badges: ReactNode;
  breadcrumbs: ReactNode;
  /** Anything the page shows under the title, such as its schedule or counts. */
  children?: ReactNode;
  menu: ReactNode;
  summary?: ReactNode;
  title: string;
  titleAside?: ReactNode;
  titleTestId: string;
}) {
  return (
    <Tile padding="lg">
      {breadcrumbs}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
          <div>
            <div className="flex items-center gap-2">
              <Heading data-testid={titleTestId} level={2} tone="inherit" variant="page">
                {title}
              </Heading>
              {titleAside}
            </div>
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
 * Every contest page's frame: the header with the trail Contests / contest (/ entry), the
 * contest's status badge, name and the Leaderboard / Entries / My entry sub-menu built from the
 * contest, then the page's body. Contests opens the league's contests on this contest (#1392).
 */
export function ContestPageFrame({
  actions,
  badges,
  children,
  contest,
  current,
  details,
  entryName,
  leagueCode,
  picksRevealed,
  summary,
  testId,
  title,
  titleAside,
  titleTestId,
}: {
  actions?: ReactNode;
  /** The header's badges: the contest's status badge unless the page says more, none for null. */
  badges?: ReactNode;
  /** The page's body, under the header. */
  children?: ReactNode;
  contest: FramedContest;
  current: ContestView | null;
  /** Anything the header shows under the title and summary, such as a schedule or notes. */
  details?: ReactNode;
  /** On an entry's page, the entry's name, the trail's last step ('' while it loads). */
  entryName?: string;
  leagueCode: string;
  /** Whether the Leaderboard option shows: its endpoint refuses until picks are revealed. */
  picksRevealed: boolean;
  summary?: ReactNode;
  testId?: string;
  /** The heading; the contest's name unless the page is about one entry. */
  title?: string;
  /** Beside the heading, such as an entry page's status. */
  titleAside?: ReactNode;
  titleTestId: string;
}) {
  const isEntryPage = entryName !== undefined;
  const trail = [
    { href: buildContestsFocusPath(leagueCode, contest), label: 'Contests' },
    isEntryPage
      ? { href: buildContestLandingPath(leagueCode, contest), label: contest.name }
      : { label: contest.name },
    ...(isEntryPage ? [{ label: entryName || 'Entry' }] : []),
  ];

  return (
    <section className="space-y-6" data-testid={testId}>
      <ContestHeader
        actions={actions}
        badges={badges === undefined ? <ContestStatusBadge status={contest.status} /> : badges}
        breadcrumbs={<Breadcrumbs items={trail} label="Contest breadcrumbs" />}
        menu={(
          <ContestSubMenu
            contestId={contest.id}
            current={current}
            leagueCode={leagueCode}
            myEntryIds={contest.myEntryIds ?? []}
            picksRevealed={picksRevealed}
          />
        )}
        summary={summary}
        title={title ?? contest.name}
        titleAside={titleAside}
        titleTestId={titleTestId}
      >
        {details}
      </ContestHeader>
      {children}
    </section>
  );
}

/**
 * A pick entry page's frame (#1296): the entry's name with its status icon beside it, a summary
 * line of the contest, any rules the page names and the entry's squad, then the page's picks.
 * The status, contest phase and dates sit in the icon's callout so the page opens on its picks.
 */
export function ContestEntryFrame({
  children,
  contest,
  entry,
  entryId,
  leagueCode,
  phase,
  picksRevealed,
  rules = [],
  status,
  statusFacts,
  testId,
  title,
}: {
  children: ReactNode;
  contest: FramedContest;
  /** The entry's own read: its squad, number and dates; null until it loads. */
  entry: { createdAt?: string | null; entryNumber: number; squadName: string; updatedAt?: string | null } | null;
  entryId: string;
  leagueCode: string;
  /** The contest's phase as the page words it. */
  phase: string;
  picksRevealed: boolean;
  /** The contest's rules as the summary names them, after its name, such as a pick'em's mode. */
  rules?: string[];
  /** The entry's status, or null while another team's entry is hidden. */
  status: ContestEntryStatus | null;
  /** The page's own lines in the status callout, after the contest's phase. */
  statusFacts?: EntryStatusFact[];
  testId?: string;
  title: string;
}) {
  return (
    <ContestPageFrame
      badges={null}
      contest={contest}
      current={entryPageView(contest, entryId)}
      entryName={title}
      leagueCode={leagueCode}
      picksRevealed={picksRevealed}
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
          {[contest.name, ...rules, ...(entry ? [entry.squadName, `Entry ${entry.entryNumber}`] : [])].join(' · ')}
        </p>
      )}
      testId={testId}
      title={title}
      titleAside={<EntryStatusCallout entry={entry} facts={statusFacts} phase={phase} status={status} />}
      titleTestId="contest-entry-heading"
    >
      {children}
    </ContestPageFrame>
  );
}
