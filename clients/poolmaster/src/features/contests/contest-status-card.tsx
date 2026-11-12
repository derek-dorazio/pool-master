import { ContestStatus, SelectionType, getSportDefinition } from '@poolmaster/shared/domain';
import type { ContestDto, SportEventDto } from '@/lib/api';
import {
  buildLeagueContestLeaderboardPath,
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import {
  CheckList,
  LinkButton,
  Notice,
  formatCount,
  formatDateTimeDisplay,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { LifecyclePanel } from './lifecycle-panel';
import { OpenContestAction } from './open-contest-action';
import { formatTimeUntil, getContestReadinessChecks } from './contest-readiness';
import { RunDrawAction } from './run-draw-action';
import { useContestDrawState } from './use-contest-draw';

/**
 * When a contest's entries close, for a sentence: its event's start, or a second-chance bracket's
 * starting round's first game (#721).
 */
function entriesCloseAt(event: SportEventDto, secondChanceRoundName: string | null) {
  return secondChanceRoundName === null
    ? `the ${getSportDefinition(event.sport).vocabulary.eventStart}`
    : `the first game of the ${secondChanceRoundName}`;
}

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
    <LifecyclePanel
      actions={(
        <>
          <OpenContestAction contestId={contest.id} contestName={contest.name} leagueId={contest.leagueId} />
          <LinkButton data-testid="contest-preview-as-member" to={buildLeagueContestPath(leagueCode, contest.id)} variant="inverse">
            Preview as a member
          </LinkButton>
        </>
      )}
      help={`Only commissioners can see it until it's open. Once it's open, members can enter until ${entriesCloseAt(event, secondChanceRoundName)}, and these settings can't change.`}
      status={contest.status}
      title={isReady ? 'Ready to open to the league' : 'Not ready to open yet'}
    >
      <CheckList
        items={checks.map((check) => ({
          id: check.id,
          isMet: check.isMet,
          label: check.label,
          testId: `contest-readiness-${check.id}`,
        }))}
        surface="inverse"
        testId="contest-readiness-checks"
      />
    </LifecyclePanel>
  );
}

/**
 * The entries that submitted an event and the squads they belong to, as the single-contest read
 * counts them (#1197).
 */
function enteredTeams(contest: ContestDto) {
  return contest.entryCount === undefined || contest.enteredSquadCount === undefined
    ? null
    : { submittedEntryCount: contest.entryCount, teamCount: contest.enteredSquadCount };
}

function OpenCard({
  contest,
  event,
  leagueCode,
  secondChanceRoundName,
  teamCount,
}: {
  contest: ContestDto;
  event: SportEventDto;
  leagueCode: string;
  secondChanceRoundName: string | null;
  teamCount: number;
}) {
  const displayPreferences = useDisplayPreferences();
  const { locale } = displayPreferences;
  const entered = enteredTeams(contest);

  return (
    <LifecyclePanel
      actions={<ViewInLeagueLink contestId={contest.id} leagueCode={leagueCode} />}
      help={secondChanceRoundName === null
        ? `Entries close at the ${getSportDefinition(event.sport).vocabulary.eventStart}, ${formatDateTimeDisplay(event.startDate, displayPreferences)}. The contest goes live then and is final when the event ends.`
        : (
          <span data-testid="contest-second-chance-close">
            {`Entries close at ${entriesCloseAt(event, secondChanceRoundName)}. The contest goes live then and is final when the event ends.`}
          </span>
        )}
      stats={entered
        ? [
          { label: 'Entries', testId: 'contest-stat-entries', value: formatNumber(entered.submittedEntryCount, locale) },
          { label: 'Yet to enter', testId: 'contest-stat-teams-to-go', value: formatNumber(Math.max(teamCount - entered.teamCount, 0), locale) },
          // A second-chance bracket closes at a round's first game, which this panel does not read.
          ...(secondChanceRoundName === null
            ? [{ label: 'Until close', testId: 'contest-stat-until-close', value: formatTimeUntil(event.startDate) }]
            : []),
        ]
        : undefined}
      status={contest.status}
      title={entered ? `${formatNumber(entered.teamCount, locale)} of ${formatNumber(teamCount, locale)} members have entered` : 'Members can enter now'}
    />
  );
}

function ViewInLeagueLink({ contestId, leagueCode }: { contestId: string; leagueCode: string }) {
  return (
    <LinkButton data-testid="contest-view-in-league" to={buildLeagueContestPath(leagueCode, contestId)} variant="inverse">
      View in league
    </LinkButton>
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
  // Every entry, submitted or not: before a draw no entry is submitted, and the draw deals to all.
  const entryCount = contest.allEntryCount;
  const drawState = useContestDrawState(contest.id);
  const drawnAt = contest.drawnAt;

  const { eventStart, participant } = getSportDefinition(event.sport).vocabulary;
  const startsAt = formatDateTimeDisplay(event.startDate, displayPreferences);
  const untilStart = { label: 'Until it starts', testId: 'contest-stat-until-close', value: formatTimeUntil(event.startDate) };

  if (drawnAt) {
    return (
      <LifecyclePanel
        actions={<ViewInLeagueLink contestId={contest.id} leagueCode={leagueCode} />}
        help={`Every entry has its ${participant.many}, and everyone in the league can see who drew whom. Entries are closed, and the contest goes live at the ${eventStart}, ${startsAt}.`}
        stats={[
          { label: 'Drawn', testId: 'contest-draw-ran', value: formatDateTimeDisplay(drawnAt, displayPreferences) },
          untilStart,
        ]}
        status={contest.status}
        title="The draw has run"
      />
    );
  }

  return (
    <LifecyclePanel
      actions={(
        <>
          {drawState.data && entryCount !== undefined ? (
            <RunDrawAction
              contestId={contest.id}
              entryCount={entryCount}
              leagueId={contest.leagueId}
              noun={participant}
              picksPerEntry={drawState.data.rosterSize}
            />
          ) : null}
          <ViewInLeagueLink contestId={contest.id} leagueCode={leagueCode} />
        </>
      )}
      help={`Run the draw once everyone has entered, before the ${eventStart}, ${startsAt}. It deals each entry its ${participant.many} at random, enters every entry and closes entries.`}
      stats={entryCount === undefined
        ? undefined
        : [{ label: 'Entries', testId: 'contest-stat-entries', value: formatNumber(entryCount, displayPreferences.locale) }, untilStart]}
      status={contest.status}
      title={entryCount === undefined ? 'Members can enter now' : `${formatCount(entryCount, 'entry', displayPreferences.locale, 'entries')} waiting for the draw`}
    >
      {drawState.isError ? (
        <Notice data-testid="contest-draw-state-error" tone="danger">
          We couldn&apos;t check whether the draw has run. Try again in a moment.
        </Notice>
      ) : null}
    </LifecyclePanel>
  );
}

function PlayedCard({
  contest,
  isFinal,
  leagueCode,
}: {
  contest: ContestDto;
  isFinal: boolean;
  leagueCode: string;
}) {
  const { locale } = useDisplayPreferences();
  const entered = enteredTeams(contest);

  return (
    <LifecyclePanel
      actions={(
        <LinkButton data-testid="contest-status-leaderboard" to={buildLeagueContestLeaderboardPath(leagueCode, contest.id)} variant="inverse">
          {isFinal ? 'See the results' : 'Full leaderboard'}
        </LinkButton>
      )}
      stats={entered
        ? [
          { label: 'Entries', testId: 'contest-stat-entries', value: formatNumber(entered.submittedEntryCount, locale) },
          { label: 'Entered', testId: 'contest-stat-teams', value: formatNumber(entered.teamCount, locale) },
        ]
        : undefined}
      status={contest.status}
      title={isFinal ? 'The event is over and the standings are final' : 'The event is under way'}
    />
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
            contest={contest}
            event={event}
            leagueCode={leagueCode}
            secondChanceRoundName={secondChanceRoundName}
            teamCount={teamCount}
          />
        );
    case ContestStatus.ACTIVE:
      return <PlayedCard contest={contest} isFinal={false} leagueCode={leagueCode} />;
    case ContestStatus.COMPLETED:
      return <PlayedCard contest={contest} isFinal leagueCode={leagueCode} />;
  }
}
