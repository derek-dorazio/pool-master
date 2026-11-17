import type { ReactNode } from 'react';
import type { ContestEntryStatus } from '@poolmaster/shared/domain';
import { Navigate, useLocation } from 'react-router';
import type { ContestDto } from '@/lib/api';
import {
  buildContestBreadcrumb,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { PageHeader } from '@/features/shared/ui';
import { ContestStatusBadge } from './contest-status-badge';
import { EntryStatusPeek, type EntryStatusFact } from './entry-status-peek';

/** What a contest page's frame reads of its contest. */
type FramedContest = Pick<ContestDto, 'endsAt' | 'id' | 'leagueId' | 'name' | 'status'>;

/**
 * Where a contest page belongs when its URL names another league (#1412): the same page under the
 * contest's own league, or null while the league loads, when the URL is right, or when the league
 * can't be read (the page then shows as it is).
 */
function useOwnLeagueAddress(leagueId: string, leagueCode: string): string | null {
  const location = useLocation();
  const { league } = useLeagueContextById(leagueId);
  if (!league || league.leagueCode.toLowerCase() === leagueCode.toLowerCase()) {
    return null;
  }
  const segments = location.pathname.split('/');
  const codeAt = segments.indexOf('league') + 1;
  if (codeAt === 0) {
    return null;
  }
  segments[codeAt] = encodeURIComponent(league.leagueCode);
  return `${segments.join('/')}${location.search}${location.hash}`;
}

/**
 * Every contest page's frame: the shared `PageHeader` with the trail Contests / contest (/ entry),
 * the contest's status badge in its status slot, the name and the summary as its fact line, then
 * the page's body. A contest has one page, whose view follows its stage (#1739), so the frame
 * carries no tabs. Contests opens the league's contests on this contest (#1392). A URL naming
 * another league is replaced with the contest's own league's (#1412).
 */
export function ContestPageFrame({
  actions,
  children,
  contest,
  entryName,
  headerTestId,
  leagueCode,
  notes,
  status,
  summary,
  testId,
  title,
  titleAside,
}: {
  actions?: ReactNode;
  /** The page's body, under the header. */
  children?: ReactNode;
  contest: FramedContest;
  /** On an entry's page, the entry's name, the trail's last step ('' while it loads). */
  entryName?: string;
  /** The header's test id; its heading is `<headerTestId>-name`. */
  headerTestId: string;
  leagueCode: string;
  /** Lines under the fact line, such as a leaderboard's notes. */
  notes?: ReactNode;
  /** The status slot: the contest's status badge unless the page says otherwise, none for null. */
  status?: ReactNode;
  /** The fact line: the contest's way to play, its schedule or counts, as plain text spans. */
  summary?: ReactNode;
  testId?: string;
  /** The heading; the contest's name unless the page is about one entry. */
  title?: string;
  /** Beside the heading, such as an entry page's status. */
  titleAside?: ReactNode;
}) {
  const ownLeagueAddress = useOwnLeagueAddress(contest.leagueId, leagueCode);
  if (ownLeagueAddress) {
    return <Navigate replace to={ownLeagueAddress} />;
  }
  const isEntryPage = entryName !== undefined;
  const trail = [
    buildContestBreadcrumb(leagueCode, contest),
    isEntryPage
      ? { href: buildLeagueContestPath(leagueCode, contest.id), label: contest.name }
      : { label: contest.name },
    ...(isEntryPage ? [{ label: entryName || 'Entry' }] : []),
  ];

  return (
    <section className="space-y-6" data-testid={testId}>
      <PageHeader
        actions={actions}
        breadcrumbLabel="Contest breadcrumbs"
        breadcrumbs={trail}
        description={notes}
        meta={summary}
        status={status === undefined ? <ContestStatusBadge status={contest.status} /> : status}
        testId={headerTestId}
        title={title ?? contest.name}
        titleAside={titleAside}
      />
      {children}
    </section>
  );
}

/**
 * A pick entry page's frame (#1296): the entry's name with its status icon beside it, a summary
 * line of the contest and any rules the page names (the title already names the entry), then the
 * page's picks.
 * The status, contest phase and dates sit in the icon's callout so the page opens on its picks.
 */
export function ContestEntryFrame({
  children,
  contest,
  entry,
  leagueCode,
  phase,
  rules = [],
  status,
  statusFacts,
  testId,
  title,
}: {
  children: ReactNode;
  contest: FramedContest;
  /** The entry's own read, for its dates; null until it loads. */
  entry: { createdAt?: string | null; updatedAt?: string | null } | null;
  leagueCode: string;
  /** The contest's phase as the page words it. */
  phase: string;
  /** The contest's rules as the summary names them, after its name, such as a pick'em's mode. */
  rules?: string[];
  /** The entry's status, or null while another team's entry is hidden. */
  status: ContestEntryStatus | null;
  /** The page's own lines in the status peek, after the contest's phase. */
  statusFacts?: EntryStatusFact[];
  testId?: string;
  title: string;
}) {
  return (
    <ContestPageFrame
      contest={contest}
      entryName={title}
      headerTestId="contest-entry-header"
      leagueCode={leagueCode}
      status={null}
      summary={(
        <span data-testid="contest-entry-summary">{[contest.name, ...rules].join(' · ')}</span>
      )}
      testId={testId}
      title={title}
      titleAside={<EntryStatusPeek entry={entry} facts={statusFacts} phase={phase} status={status} />}
    >
      {children}
    </ContestPageFrame>
  );
}
