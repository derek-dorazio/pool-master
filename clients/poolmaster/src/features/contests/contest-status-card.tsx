import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContestDto, SportEventDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { DateDisplay, LinkButton } from '@/features/shared/ui';
import { OpenContestAction } from './open-contest-action';
import { formatTimeUntil, getContestReadinessChecks } from './contest-readiness';
import { fetchContestEntries } from './use-contest-entries';

function StatusCardFrame({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: ReactNode;
}) {
  return (
    <section
      className="grid gap-3 rounded-2xl border border-inverse-border bg-surface-inverse px-5 py-5 text-on-inverse"
      data-testid="contest-status-card"
    >
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</div>
      <h2 className="font-display text-xl font-extrabold" data-testid="contest-status-card-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, testId, value }: { label: string; testId: string; value: ReactNode }) {
  return (
    <div className="min-w-24 rounded-xl border border-inverse-border bg-on-inverse-subtle px-3 py-2" data-testid={testId}>
      <div className="font-display text-xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-[0.12em] text-on-inverse-muted">{label}</div>
    </div>
  );
}

const inverseLinkClassName = 'border-inverse-border bg-transparent text-on-inverse hover:bg-on-inverse-hover';

function NotOpenCard({
  contest,
  event,
  leagueCode,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
}) {
  const checks = getContestReadinessChecks(event);
  const isReady = checks.every((check) => check.isMet);

  return (
    <StatusCardFrame
      eyebrow="Not open yet · only commissioners can see it"
      title={isReady ? 'Ready to open to the league' : 'Not ready to open yet'}
    >
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" data-testid="contest-readiness-checks">
        {checks.map((check) => (
          <li
            className="inline-flex items-center gap-1.5"
            data-met={check.isMet}
            data-testid={`contest-readiness-${check.id}`}
            key={check.id}
          >
            {check.isMet ? <Check aria-hidden size={14} /> : <X aria-hidden size={14} />}
            {check.label}
          </li>
        ))}
      </ul>
      <p className="text-sm text-on-inverse-muted">
        Once it&apos;s open, members can enter until the first tee time, and these settings can&apos;t change.
      </p>
      <div className="flex flex-wrap gap-3">
        <OpenContestAction contestId={contest.id} leagueId={contest.leagueId} />
        <LinkButton
          className={inverseLinkClassName}
          data-testid="contest-preview-as-member"
          state={{ leagueCode }}
          to={buildLeagueContestPath(leagueCode, contest.id)}
          variant="secondary"
        >
          Preview as a member
        </LinkButton>
      </div>
    </StatusCardFrame>
  );
}

function useEnteredTeams(contestId: string) {
  return useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
    select: (response) => {
      const submitted = response.entries.filter((entry) => entry.status === ContestEntryStatus.SUBMITTED);
      return {
        submittedEntryCount: submitted.length,
        teamCount: new Set(submitted.map((entry) => entry.squadId)).size,
      };
    },
  });
}

function OpenCard({
  contestId,
  event,
  leagueCode,
  teamCount,
}: {
  contestId: string;
  event: SportEventDto;
  leagueCode: string;
  teamCount: number;
}) {
  const entered = useEnteredTeams(contestId).data;

  return (
    <StatusCardFrame
      eyebrow="Open for entries"
      title={entered ? `${entered.teamCount} of ${teamCount} teams have entered` : 'Open for entries'}
    >
      {entered ? (
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Entries" testId="contest-stat-entries" value={entered.submittedEntryCount} />
          <Stat label="Teams to go" testId="contest-stat-teams-to-go" value={Math.max(teamCount - entered.teamCount, 0)} />
          <Stat label="Until close" testId="contest-stat-until-close" value={formatTimeUntil(event.startDate)} />
        </div>
      ) : null}
      <p className="text-sm text-on-inverse-muted">
        Entries close at the first tee time, <DateDisplay className="text-on-inverse-muted" value={event.startDate} />.
        The contest goes live then and is final when the event ends.
      </p>
      <div>
        <LinkButton
          className={inverseLinkClassName}
          data-testid="contest-view-in-league"
          state={{ leagueCode }}
          to={buildLeagueContestPath(leagueCode, contestId)}
          variant="secondary"
        >
          View in league
        </LinkButton>
      </div>
    </StatusCardFrame>
  );
}

function PlayedCard({
  contestId,
  isFinal,
  leagueCode,
}: {
  contestId: string;
  isFinal: boolean;
  leagueCode: string;
}) {
  const entered = useEnteredTeams(contestId).data;

  return (
    <StatusCardFrame
      eyebrow={isFinal ? 'Final' : 'Live'}
      title={isFinal ? 'The event is over and the standings are final' : 'The event is under way'}
    >
      {entered ? (
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Entries" testId="contest-stat-entries" value={entered.submittedEntryCount} />
          <Stat label="Teams" testId="contest-stat-teams" value={entered.teamCount} />
        </div>
      ) : null}
      <div>
        <LinkButton
          data-testid="contest-status-leaderboard"
          state={{ leagueCode }}
          to={buildLeagueContestLeaderboardPath(leagueCode, contestId)}
        >
          {isFinal ? 'See the results' : 'Full leaderboard'}
        </LinkButton>
      </div>
    </StatusCardFrame>
  );
}

/**
 * What a contest needs from its commissioner now, by status: before opening, the readiness checks
 * and Open to league; while open, how many teams have entered; once live or final, the way to
 * its leaderboard.
 */
export function ContestStatusCard({
  contest,
  event,
  leagueCode,
  teamCount,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
  teamCount: number;
}) {
  switch (contest.status) {
    case ContestStatus.DRAFT:
      return <NotOpenCard contest={contest} event={event} leagueCode={leagueCode} />;
    case ContestStatus.OPEN:
      return <OpenCard contestId={contest.id} event={event} leagueCode={leagueCode} teamCount={teamCount} />;
    case ContestStatus.ACTIVE:
      return <PlayedCard contestId={contest.id} isFinal={false} leagueCode={leagueCode} />;
    case ContestStatus.COMPLETED:
      return <PlayedCard contestId={contest.id} isFinal leagueCode={leagueCode} />;
  }
}
