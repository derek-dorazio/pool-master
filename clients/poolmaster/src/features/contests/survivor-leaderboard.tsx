import { useQueries } from '@tanstack/react-query';
import { Lock, X } from 'lucide-react';
import { ContestEntryStatus, SportEventStatus, SurvivorWeekOutcome, describeSurvivorRules } from '@poolmaster/shared/domain';
import type { ContestDto, GamePicksResponse } from '@/lib/api';
import { Chip, DetailsPeek, PeekCard, Text, cn, formatCount, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import { isMySquadsEntry, totalColumn } from './leaderboard-columns';
import { EventScheduleChip } from './event-schedule-chip';
import { LeaderboardFrame } from './leaderboard-kit';
import { roundWeek, survivorPickTeam } from './pick-em-week';
import { SeasonWeeksGrid, type SeasonWeeksDetail } from './season-weeks-grid';
import {
  SURVIVOR_SHOWN_WEEKS,
  survivorCellView,
  survivorCurrentWeek,
  survivorDetailWeeks,
  survivorEarlierLabel,
  survivorGameLine,
  survivorPickOf,
  survivorResultLine,
  survivorStatusLabel,
  survivorWeekKey,
  type SurvivorDetailWeek,
  type SurvivorRow,
  type SurvivorWeek,
  type SurvivorWeekName,
} from './survivor-board';
import { useEventRoundLabels } from './use-bracket-round-label';
import { useContestLeague } from './use-contest-league';
import { useSurvivorLeaderboardQuery } from './use-contest-leaderboard';
import { gamePicksQueryOptions } from './use-game-picks';
import { useLeaderboardFallback } from './use-leaderboard-fallback';

/** The prefix of the board's test ids. */
const TEST_ID = 'survivor-leaderboard';

/** A week's team reads green once survived, red once lost, and plain while its game is to come. */
const SURVIVOR_CELL_TONES = { survived: 'done', lost: 'danger', pending: 'default' } as const;

/**
 * A week's column heading: its name, or with the shared Postponed or Cancelled chip (#1768) when
 * it is not going ahead as scheduled.
 */
function WeekHeading({ week, weekName }: { week: SurvivorWeek; weekName: SurvivorWeekName }) {
  const name = weekName(week);
  if (week.status === SportEventStatus.CANCELLED || week.status === SportEventStatus.POSTPONED) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {name}
        <EventScheduleChip status={week.status} testId={`survivor-leaderboard-week-${week.sportEventId}-schedule`} />
      </span>
    );
  }
  return name;
}

/**
 * The viewer's own entries' picks in the current week, by entry: the board shows a pick only from
 * its game's kickoff, and an entry's own pick is its own to see before then. Only a submitted
 * week's pick counts, as on the board.
 */
function useOwnWeekTeams(contest: ContestDto, ownEntryIds: readonly string[], week: SurvivorWeek | null): ReadonlyMap<string, string> {
  const eventId = week?.sportEventId ?? '';
  const reads = useQueries({ queries: (week ? ownEntryIds : []).map((entryId) => gamePicksQueryOptions(contest, entryId, eventId)) });
  const teamOf = (picks: GamePicksResponse | undefined) => {
    if (!picks || !week || picks.status !== ContestEntryStatus.SUBMITTED) {
      return null;
    }
    return survivorPickTeam(week.roundCount > 1 ? roundWeek(picks, week.roundNumber) : picks)?.name ?? null;
  };
  return new Map(ownEntryIds.flatMap((entryId, index) => {
    const team = teamOf(reads[index]?.data);
    return team === null ? [] : [[entryId, team] as const];
  }));
}

/**
 * One entry's cell for one week: its team, green once survived and red struck through with ✗ once
 * lost; 🔒 for a pick waiting on its game's kickoff. A pick with a game opens it, score and all.
 */
function WeekCell({ entry, ownTeam, week, weekName }: { entry: SurvivorRow; ownTeam: string | null; week: SurvivorWeek; weekName: SurvivorWeekName }) {
  const { formatKickoff } = useKickoffFormat();
  const pick = survivorPickOf(entry, week);
  const view = survivorCellView(pick, ownTeam);
  const testId = `${TEST_ID}-week-${survivorWeekKey(week)}-${entry.entryId}`;
  if (view.kind === 'blank') {
    return <span data-testid={testId} />;
  }
  if (view.kind === 'hidden') {
    return (
      <Text as="span" className="inline-flex" data-state="hidden" data-testid={testId} size="inherit" tone="muted">
        <Lock aria-label="Hidden until kickoff" size={14} />
      </Text>
    );
  }
  if (view.kind === 'missed') {
    return (
      <Text as="span" className="inline-flex items-center" data-state="lost" data-testid={testId} size="inherit" tone="danger" weight="semibold">
        <X aria-label="No pick" size={14} strokeWidth={3} />
      </Text>
    );
  }
  const label = (
    <Text
      as="span"
      className={cn(
        'inline-flex min-w-9 items-center justify-center gap-0.5 rounded px-1 py-0.5 whitespace-nowrap',
        view.tone === 'survived' && 'bg-[var(--status-active-surface)]',
        view.tone === 'lost' && 'bg-[var(--status-danger-surface)] line-through',
        view.tone === 'pending' && 'border border-border',
      )}
      tone={SURVIVOR_CELL_TONES[view.tone]}
      variant="caption"
      weight="semibold"
    >
      {view.tone === 'lost' ? <X aria-hidden size={12} strokeWidth={3} /> : null}
      {view.label}
    </Text>
  );
  return (
    <span className="inline-flex" data-state={view.tone} data-testid={testId}>
      {pick?.game ? (
        <DetailsPeek icon={label} label={`${weekName(week)} for ${entry.entryName}`} testId={`${testId}-peek`} trigger="text">
          <PeekCard facts={[]} subtitle={survivorResultLine(pick, null, formatKickoff)} title={survivorGameLine(pick)} />
        </DetailsPeek>
      ) : label}
    </span>
  );
}

/** A game's kickoff in the member's zone. */
function useKickoffFormat() {
  const displayPreferences = useDisplayPreferences();
  return { formatKickoff: (startsAt: string) => formatDateTimeDisplay(startsAt, displayPreferences) };
}

/** A week of an opened entry: the game, then a muted line on how it went. A lost week reads red. */
function WeekLine({ detail, formatKickoff, testId }: { detail: SurvivorDetailWeek; formatKickoff: (startsAt: string) => string; testId: string }) {
  const result = survivorResultLine(detail.pick, detail.livesLeft, formatKickoff);
  const isLost = detail.livesLeft !== null;
  return (
    <span className="block min-w-0" data-testid={testId}>
      <Text as="span" className="block truncate" size="inherit" weight="semibold">{survivorGameLine(detail.pick)}</Text>
      {result ? <Text as="span" className="block truncate" tone={isLost ? 'danger' : 'muted'} variant="caption">{result}</Text> : null}
    </span>
  );
}

/**
 * A survivor contest's leaderboard (#719, #1757): entries down and weeks across, newest first,
 * with the Entry column pinned while earlier weeks scroll sideways. Under each entry's name its
 * status ("In", "In · 1 life left", "Out · Week 9"), then the weeks it survived, then each week's
 * team: green survived, red struck ✗ lost, 🔒 until its game kicks off (the viewer's own show).
 * Opening an entry lists its latest six weeks, each game with how it went; earlier weeks open
 * from one line. On a playoff bracket (#785) each round is a week, named as the bracket names it.
 * Polled while the contest is live, so entries drop out as results come in.
 */
export function SurvivorLeaderboard({ contest }: { contest: ContestDto }) {
  const contestId = contest.id;
  const { locale } = useDisplayPreferences();
  const { formatKickoff } = useKickoffFormat();
  const leaderboardQuery = useSurvivorLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);
  const mySquadId = viewer.mySquadId;
  const board = leaderboardQuery.data;
  // A playoff's rounds (#785) are named as its bracket names them.
  const playoffEventId = board?.weeks.find((week) => week.roundCount > 1)?.sportEventId ?? '';
  const roundLabel = useEventRoundLabels(playoffEventId);
  const weekName: SurvivorWeekName = (week) => (week.roundCount > 1 ? roundLabel(week.roundNumber) : week.name);
  const current = survivorCurrentWeek(board?.weeks ?? []);
  const ownEntryIds = (board?.entries ?? []).filter(isMySquadsEntry(mySquadId)).map((entry) => entry.entryId);
  const ownTeams = useOwnWeekTeams(contest, current.week && current.week.status !== SportEventStatus.COMPLETED ? ownEntryIds : [], current.week);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'survivorLeaderboard.load.failed', contestId });

  if (fallback || !board) {
    return fallback;
  }

  const stillIn = board.entries.filter((entry) => entry.alive).length;
  const isUnderWay = board.weeks.some((week) => week.started);
  const ownTeamIn = (entry: SurvivorRow, week: SurvivorWeek) =>
    (current.week && survivorWeekKey(week) === survivorWeekKey(current.week) ? ownTeams.get(entry.entryId) ?? null : null);

  const details = (entry: SurvivorRow): SeasonWeeksDetail[] => {
    const played = survivorDetailWeeks(entry, board.weeks);
    const shown = played.slice(0, SURVIVOR_SHOWN_WEEKS);
    const earlier = played.slice(SURVIVOR_SHOWN_WEEKS);
    const rows: SeasonWeeksDetail[] = shown.map((detail) => {
      const key = survivorWeekKey(detail.week);
      return {
        id: key,
        testId: `${TEST_ID}-detail-${key}-${entry.entryId}`,
        entry: <Text as="span" className="block truncate" size="inherit" weight="semibold">{weekName(detail.week)}</Text>,
        span: <WeekLine detail={detail} formatKickoff={formatKickoff} testId={`${TEST_ID}-game-${key}-${entry.entryId}`} />,
      };
    });
    if (earlier.length > 0) {
      const label = survivorEarlierLabel(earlier.map((detail) => detail.week));
      rows.push({
        id: 'earlier',
        testId: `${TEST_ID}-detail-earlier-${entry.entryId}`,
        entry: (
          <DetailsPeek icon={`${label} ›`} label={`${label} for ${entry.entryName}`} testId={`${TEST_ID}-earlier-${entry.entryId}`} trigger="text">
            <PeekCard
              facts={earlier.map((detail) => ({
                label: weekName(detail.week),
                value: `${survivorGameLine(detail.pick)} · ${survivorResultLine(detail.pick, detail.livesLeft, formatKickoff)}`,
              }))}
              title={`${entry.entryName} · ${label}`}
            />
          </DetailsPeek>
        ),
      });
    }
    return rows;
  };

  return (
    <LeaderboardFrame
      contest={contest}
      isUnscored={board.entries.length > 0 && board.entries.every((entry) => entry.weeks.every((week) => week.outcome === null || week.outcome === SurvivorWeekOutcome.PENDING))}
      finalRows={board.entries.map((entry) => ({
        entryName: entry.entryName,
        isMine: isMySquadsEntry(mySquadId)(entry),
        position: entry.position,
        score: `${formatCount(entry.weeksSurvived, 'week', locale, 'weeks')} survived`,
      }))}
      leagueCode={leagueCode}
      notes={(
        <>
          {board.entries.length ? (
            <p data-testid="survivor-leaderboard-still-in">{`${formatCount(stillIn, 'entry', locale, 'entries')} still in.`}</p>
          ) : null}
          {isUnderWay ? null : (
            <p data-testid="survivor-leaderboard-not-started">Picks show from each game&apos;s kickoff. Entries are listed once they submit a week.</p>
          )}
        </>
      )}
      summary={(
        <span data-testid="survivor-leaderboard-rules">{describeSurvivorRules(null)}</span>
      )}
    >
      <SeasonWeeksGrid
        board={{ contestId, leagueCode, leagueId: contest.leagueId, mySquadId }}
        currentWeek={{ id: current.week ? survivorWeekKey(current.week) : null, isLive: current.isLive }}
        data={board.entries}
        details={details}
        emptyMessage="No entry has submitted a week yet."
        summaryColumns={[
          {
            id: 'standing',
            header: 'Status',
            accessorFn: (row) => survivorStatusLabel(row, board.weeks, weekName),
            cell: ({ row }) => (
              <Chip
                className="whitespace-nowrap"
                data-testid={`${TEST_ID}-standing-${row.original.entryId}`}
                tone={row.original.alive ? 'success' : 'neutral'}
              >
                {survivorStatusLabel(row.original, board.weeks, weekName)}
              </Chip>
            ),
          },
          totalColumn<SurvivorRow>(TEST_ID, { header: 'Weeks', id: 'survived', value: (row) => row.weeksSurvived }),
        ]}
        testIdPrefix={TEST_ID}
        weekCell={(entry, week) => <WeekCell entry={entry} ownTeam={ownTeamIn(entry, week)} week={week} weekName={weekName} />}
        weekHeading={(week) => <WeekHeading week={week} weekName={weekName} />}
        weekId={survivorWeekKey}
        weeks={board.weeks}
      />
    </LeaderboardFrame>
  );
}
