import { ContestStatus, SelectionType, getSportDefinition, pluralize  } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContestDto, SportEventDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { DateDisplay, Eyebrow, formatDateTimeDisplay, LinkButton, useDisplayPreferences } from '@/features/shared/ui';
import { OpenContestAction } from './open-contest-action';
import { formatTimeUntil, getContestReadinessChecks } from './contest-readiness';
import { RunDrawAction } from './run-draw-action';
import { useContestDrawState } from './use-contest-draw';
import { hasSubmittedAnyEvent } from './contest-events';
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
      <Eyebrow>{eyebrow}</Eyebrow>
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
      <div className="text-xs uppercase tracking-label text-on-inverse-muted">{label}</div>
    </div>
  );
}

/**
 * When a contest's entries close, for a sentence: its event's start, or a second-chance bracket's
 * starting round's first game (#721).
 */
function entriesCloseAt(event: SportEventDto, secondChanceRoundName: string | null) {
  return secondChanceRoundName === null
    ? `the ${getSportDefinition(event.sport).vocabulary.eventStart}`
    : `the first game of the ${secondChanceRoundName}`;
}

const inverseLinkClassName = 'border-inverse-border bg-transparent text-on-inverse hover:bg-on-inverse-hover';

function NotOpenCard({
  contest,
  event,
  leagueCode,
  secondChanceRoundName,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
  secondChanceRoundName: string | null;
}) {
  const checks = getContestReadinessChecks(event, new Date(), secondChanceRoundName);
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
        Once it&apos;s open, members can enter until {entriesCloseAt(event, secondChanceRoundName)}, and these settings can&apos;t change.
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
      const submitted = response.entries.filter(hasSubmittedAnyEvent);
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
  secondChanceRoundName,
  teamCount,
}: {
  contestId: string;
  event: SportEventDto;
  leagueCode: string;
  secondChanceRoundName: string | null;
  teamCount: number;
}) {
  const entered = useEnteredTeams(contestId).data;

  return (
    <StatusCardFrame
      eyebrow="Open for entries"
      title={entered ? `${entered.teamCount} of ${teamCount} members have entered` : 'Open for entries'}
    >
      {entered ? (
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Entries" testId="contest-stat-entries" value={entered.submittedEntryCount} />
          <Stat label="Yet to enter" testId="contest-stat-teams-to-go" value={Math.max(teamCount - entered.teamCount, 0)} />
          {/* A second-chance bracket closes at a round's first game, which this card does not read. */}
          {secondChanceRoundName === null ? (
            <Stat label="Until close" testId="contest-stat-until-close" value={formatTimeUntil(event.startDate)} />
          ) : null}
        </div>
      ) : null}
      {secondChanceRoundName === null ? (
        <p className="text-sm text-on-inverse-muted">
          Entries close at the {getSportDefinition(event.sport).vocabulary.eventStart}, <DateDisplay className="text-on-inverse-muted" value={event.startDate} />.
          The contest goes live then and is final when the event ends.
        </p>
      ) : (
        <p className="text-sm text-on-inverse-muted" data-testid="contest-second-chance-close">
          Entries close at {entriesCloseAt(event, secondChanceRoundName)}. The contest goes live then and is final when the event ends.
        </p>
      )}
      <ViewInLeagueLink contestId={contestId} leagueCode={leagueCode} />
    </StatusCardFrame>
  );
}

/** Every entry, submitted or not: before a draw no entry is submitted, and the draw deals to all. */
function useEntryCount(contestId: string) {
  return useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
    select: (response) => response.entries.length,
  });
}

function ViewInLeagueLink({ contestId, leagueCode }: { contestId: string; leagueCode: string }) {
  return (
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
  );
}

/**
 * An open random-draw contest: entries waiting for the commissioner's draw, with Run draw, or
 * once it has run, when it ran and that entries are closed.
 */
function DrawOpenCard({
  contest,
  event,
  leagueCode,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
}) {
  const displayPreferences = useDisplayPreferences();
  const entryCount = useEntryCount(contest.id).data;
  const drawState = useContestDrawState(contest.id);
  const drawnAt = contest.drawnAt;

  if (drawnAt) {
    return (
      <StatusCardFrame eyebrow="Drawn · entries closed" title="The draw has run">
        <p className="text-sm text-on-inverse-muted" data-testid="contest-draw-ran">
          {`Drawn ${formatDateTimeDisplay(drawnAt, displayPreferences)}. Every entry has its ${getSportDefinition(event.sport).vocabulary.participant.many}, and everyone in the league can see who drew whom. `}
          The contest goes live at the {getSportDefinition(event.sport).vocabulary.eventStart}, <DateDisplay className="text-on-inverse-muted" value={event.startDate} />.
        </p>
        <ViewInLeagueLink contestId={contest.id} leagueCode={leagueCode} />
      </StatusCardFrame>
    );
  }

  return (
    <StatusCardFrame
      eyebrow="Open for entries · waiting for the draw"
      title={entryCount === undefined ? 'Open for entries' : `${pluralize(entryCount, 'entry', 'entries')} waiting for the draw`}
    >
      {entryCount !== undefined ? (
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Entries" testId="contest-stat-entries" value={entryCount} />
          <Stat label="Until it starts" testId="contest-stat-until-close" value={formatTimeUntil(event.startDate)} />
        </div>
      ) : null}
      <p className="text-sm text-on-inverse-muted">
        Run the draw once everyone has entered, before the {getSportDefinition(event.sport).vocabulary.eventStart},{' '}
        <DateDisplay className="text-on-inverse-muted" value={event.startDate} />. It deals each entry its{' '}
        {getSportDefinition(event.sport).vocabulary.participant.many} at
        random, enters every entry and closes entries.
      </p>
      {drawState.isError ? (
        <p className="text-sm text-on-inverse-muted" data-testid="contest-draw-state-error">
          We couldn&apos;t check whether the draw has run. Try again in a moment.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {drawState.data && entryCount !== undefined ? (
          <RunDrawAction
            contestId={contest.id}
            entryCount={entryCount}
            leagueId={contest.leagueId}
            noun={getSportDefinition(event.sport).vocabulary.participant}
            picksPerEntry={drawState.data.rosterSize}
          />
        ) : null}
        <ViewInLeagueLink contestId={contest.id} leagueCode={leagueCode} />
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
          <Stat label="Entered" testId="contest-stat-teams" value={entered.teamCount} />
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
 * and Open to league; while open, how many squads have entered (or, for a random draw, Run draw
 * and then when it ran); once live or final, the way to
 * its leaderboard.
 */
export function ContestStatusCard({
  contest,
  event,
  leagueCode,
  secondChanceRoundName = null,
  teamCount,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
  /** A second-chance bracket's starting round by name (#721): its entries close at that round's first game. */
  secondChanceRoundName?: string | null;
  teamCount: number;
}) {
  switch (contest.status) {
    case ContestStatus.DRAFT:
      return <NotOpenCard contest={contest} event={event} leagueCode={leagueCode} secondChanceRoundName={secondChanceRoundName} />;
    case ContestStatus.OPEN:
      return contest.selectionType === SelectionType.RANDOM_DRAW
        ? <DrawOpenCard contest={contest} event={event} leagueCode={leagueCode} />
        : (
          <OpenCard
            contestId={contest.id}
            event={event}
            leagueCode={leagueCode}
            secondChanceRoundName={secondChanceRoundName}
            teamCount={teamCount}
          />
        );
    case ContestStatus.ACTIVE:
      return <PlayedCard contestId={contest.id} isFinal={false} leagueCode={leagueCode} />;
    case ContestStatus.COMPLETED:
      return <PlayedCard contestId={contest.id} isFinal leagueCode={leagueCode} />;
  }
}
