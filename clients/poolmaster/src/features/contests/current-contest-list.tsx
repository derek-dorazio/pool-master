import type { ReactNode } from 'react';
import { ContestStatus } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ContestDto, ContestEntryPlaceDto } from '@/lib/api';
import { buildLeagueAdminContestPath, buildLeagueContestPath } from '@/features/leagues/league-routing';
import {
  DateDisplay,
  LinkButton,
  SectionEmpty,
  SectionRow,
  SectionRows,
  StatusBadge,
  formatCount,
  formatNumber,
  formatPlace,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { EventScheduleChip } from './event-schedule-chip';
import { describeContestNextStep, type ContestNextStep } from './my-contest-entry';
import { contestScheduleChipStatus } from './schedule-changes';
import { StartEntryButton } from './start-entry-button';
import type { MyContestEntries } from './use-contest-entries';
import { listedContestStartsAt } from './use-contest-schedule';

/**
 * League Home's More contests (#1763): current contests, entered or not, one row shape for every
 * state, in the order given (Open, Live, then Set up for commissioners). Each row is the contest's
 * name, a muted status line, and the viewer's next step as a button: Make your picks, Edit picks
 * and Add entry, or Full. A tap anywhere else on the row opens the contest page. Drawn as a
 * section card's body; `focusContestId` tints and scrolls to the contest the viewer came from.
 */
export function CurrentContestList({
  canExpand,
  contests,
  emptyBody,
  focusContestId = null,
  hasTeam,
  leagueCode,
  myEntries,
  now,
  testIdPrefix,
}: {
  /** Whether the viewer commissions the league, so a full contest offers Expand. */
  canExpand: boolean;
  /** The contests in the order they show, as `splitHomeContests` lists them. */
  contests: readonly ContestDto[];
  emptyBody: string;
  focusContestId?: string | null;
  hasTeam: boolean;
  leagueCode: string;
  myEntries: Pick<MyContestEntries, 'bestPlaceByContestId' | 'entriesByContestId' | 'state'>;
  now: Date;
  testIdPrefix: string;
}) {
  if (!contests.length) {
    return <SectionEmpty testId={`${testIdPrefix}-empty`}>{emptyBody}</SectionEmpty>;
  }

  return (
    <SectionRows testId={`${testIdPrefix}-list`}>
      {contests.map((contest) => {
        const testId = `${testIdPrefix}-${contest.id}`;
        const entries = myEntries.entriesByContestId.get(contest.id);
        const step = describeContestNextStep({
          bestPlace: myEntries.bestPlaceByContestId.get(contest.id),
          contest,
          entriesState: myEntries.state,
          hasTeam,
          leagueCode,
          myEntries: entries,
          now,
        });
        return (
          <SectionRow
            actions={renderActions(step, contest, leagueCode, canExpand, testId)}
            facts={<ContestStatusLine contest={contest} myEntryCount={entries?.length ?? 0} step={step} testId={`${testId}-status`} />}
            isHighlighted={contest.id === focusContestId}
            key={contest.id}
            name={contest.name}
            note={step.kind === 'note' ? <span data-testid={`${testId}-note`}>{step.note}</span> : undefined}
            testId={testId}
            to={buildLeagueContestPath(leagueCode, contest.id)}
          />
        );
      })}
    </SectionRows>
  );
}

/** The row's buttons for its next step, or nothing when the row itself is the way in. */
function renderActions(step: ContestNextStep, contest: ContestDto, leagueCode: string, canExpand: boolean, testId: string) {
  switch (step.kind) {
    case 'start':
      return <StartEntryButton contestId={contest.id} label="Make your picks" leagueCode={leagueCode} size="sm" testId={`${testId}-make-picks`} />;
    case 'entered':
      return (
        <>
          <LinkButton data-testid={`${testId}-edit-picks`} size="sm" to={step.edit.to}>{step.edit.label}</LinkButton>
          {step.canAddEntry ? (
            <StartEntryButton contestId={contest.id} label="Add entry" leagueCode={leagueCode} size="sm" testId={`${testId}-add-entry`} variant="secondary" />
          ) : null}
        </>
      );
    case 'full':
      return (
        <>
          <StatusBadge data-testid={`${testId}-full`} tone="neutral">Full</StatusBadge>
          {/* Members never see expansions or prices; its commissioners can expand it. */}
          {canExpand ? (
            <LinkButton data-testid={`${testId}-expand`} size="sm" to={buildLeagueAdminContestPath(leagueCode, contest.id)} variant="secondary">
              Expand
            </LinkButton>
          ) : null}
        </>
      );
    case 'none':
    case 'note':
    case 'standing':
      return undefined;
  }
}

/**
 * The muted line under a contest's name: its status, then what matters at that status. Open:
 * when it closes and how many have entered. Live: the viewer's place of how many, or how many
 * entries when they are not in it. Set up: when it starts. "Your 2 entries" when they have more
 * than one. The shared Postponed or Cancelled chip follows the status when the contest is off
 * schedule (#1768).
 */
function ContestStatusLine({
  contest,
  myEntryCount,
  step,
  testId,
}: {
  contest: ContestDto;
  myEntryCount: number;
  step: ContestNextStep;
  testId: string;
}) {
  const { locale } = useDisplayPreferences();
  const startsAt = listedContestStartsAt(contest);
  const entryCount = contest.entryCount ?? 0;
  const parts: { key: string; node: ReactNode }[] = [{ key: 'status', node: enumLabel('ContestStatus', contest.status) }];
  const scheduleChip = contestScheduleChipStatus(contest.sportEvents);
  if (scheduleChip) {
    parts.push({ key: 'schedule', node: <EventScheduleChip status={scheduleChip} testId={`${testId}-schedule`} /> });
  }
  if (contest.status === ContestStatus.OPEN) {
    if (startsAt && step.kind !== 'none') {
      parts.push({ key: 'closes', node: <>closes <DateDisplay timeStyle={null} tone="inherit" value={startsAt} /></> });
    }
    parts.push({ key: 'entries', node: formatCount(entryCount, 'entry', locale, 'entries') });
  } else if (contest.status === ContestStatus.ACTIVE) {
    parts.push(step.kind === 'standing' && step.place
      ? { key: 'place', node: describePlaceOf(step.place, entryCount, locale) }
      : { key: 'entries', node: formatCount(entryCount, 'entry', locale, 'entries') });
  } else if (startsAt) {
    parts.push({ key: 'starts', node: <>starts <DateDisplay timeStyle={null} tone="inherit" value={startsAt} /></> });
  }
  if (myEntryCount > 1) {
    parts.push({ key: 'mine', node: `Your ${formatNumber(myEntryCount, locale)} entries` });
  }

  return (
    <span className="flex flex-wrap items-center gap-x-1" data-testid={testId}>
      {parts.map(({ key, node }, index) => (
        <span className="inline-flex items-center gap-x-1" key={key}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {node}
        </span>
      ))}
    </span>
  );
}

/** "you're 3rd of 14": the viewer's best entry's place among the contest's entries. */
function describePlaceOf(place: ContestEntryPlaceDto, entryCount: number, locale: string): string {
  return `you're ${formatPlace(place)} of ${formatNumber(entryCount, locale)}`;
}
