import { useQueries, useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { PickOutcome, SportEventStatus, formatPickEmRulesName } from '@poolmaster/shared/domain';
import type { ContestDto, PickEmLeaderboardResponse } from '@/lib/api';
import { DetailsPeek, PeekCard, Text, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import { formatPoints } from './bracket-layout';
import { EventScheduleChip } from './event-schedule-chip';
import { isMySquadsEntry, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, YourBestNote } from './leaderboard-kit';
import { pickEmBoardGames, pickEmShownWeeks, pickEmWeekCell, pickLabel, reportMissingTeam, teamNameIn, teamNamesOf, type PickEmBoardPick } from './pick-em-board';
import { SeasonWeeksGrid, type SeasonWeeksDetail } from './season-weeks-grid';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { useContestLeague } from './use-contest-league';
import { usePickEmLeaderboardQuery } from './use-contest-leaderboard';
import { eventFieldQueryOptions, useLeaderboardEventGames } from './use-event-games';
import { gamePicksQueryOptions } from './use-game-picks';

type PickEmRow = PickEmLeaderboardResponse['entries'][number];
type PickEmWeek = PickEmLeaderboardResponse['weeks'][number];

/** The prefix of the board's test ids. */
const TEST_ID = 'pick-em-leaderboard';

/** A week's column name, with the shared Cancelled chip (#1768) when it is called off. */
function weekHeading(week: PickEmWeek): ReactNode {
  if (week.status !== SportEventStatus.CANCELLED) {
    return week.name;
  }
  return (
    <>
      {week.name}
      <EventScheduleChip status={week.status} testId={`${TEST_ID}-week-${week.sportEventId}-schedule`} />
    </>
  );
}

/** One entry's cell for one week: its picks right so far, a medal for the week's top three, and a peek on how the week went. */
function WeekCell({ entry, week }: { entry: PickEmRow; week: PickEmWeek }) {
  const view = pickEmWeekCell(week, entry.weeks.find((cell) => cell.sportEventId === week.sportEventId));
  const testId = `${TEST_ID}-week-${week.sportEventId}-${entry.entryId}`;
  if (!view.peek) {
    return <span className="text-muted-foreground" data-testid={testId}>{view.text}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" data-testid={testId}>
      <DetailsPeek icon={view.text} label={`${week.name} for ${entry.entryName}`} testId={`${testId}-peek`} trigger="text">
        <PeekCard facts={view.peek.facts} title={view.peek.title} />
      </DetailsPeek>
      {view.medal ? <span aria-label="Top three this week" data-testid={`${testId}-medal`} role="img">{view.medal}</span> : null}
    </span>
  );
}

const OUTCOME_TONES: Partial<Record<PickOutcome, 'done' | 'danger'>> = { [PickOutcome.CORRECT]: 'done', [PickOutcome.BUSTED]: 'danger' };

/** An entry's pick on a game: the team, then a green ✓ once it came true or a red ✗ once it missed. */
function PickCell({ label, pick, testId }: { label: string; pick: Pick<PickEmBoardPick, 'outcome'>; testId: string }) {
  return (
    <Text
      as="span"
      className="inline-flex items-center gap-1 whitespace-nowrap"
      data-outcome={pick.outcome}
      data-testid={testId}
      size="inherit"
      tone={OUTCOME_TONES[pick.outcome] ?? 'inherit'}
      weight="medium"
    >
      <span className="max-w-20 truncate sm:max-w-none">{label}</span>
      {pick.outcome === PickOutcome.CORRECT ? <Check aria-label="Right" size={14} strokeWidth={3} /> : null}
      {pick.outcome === PickOutcome.BUSTED ? <X aria-label="Missed" size={14} strokeWidth={3} /> : null}
      {pick.outcome === PickOutcome.PUSH ? <Text tone="muted" variant="caption">push</Text> : null}
    </Text>
  );
}

/**
 * The viewer's own entries' picks on the current week, game by game: the board shows a pick only
 * once its game kicks off, and an entry's own picks are its own to see before then.
 */
function useOwnWeekPicks(contest: ContestDto, ownEntryIds: readonly string[], weekId: string): ReadonlyMap<string, ReadonlyMap<string, PickEmBoardPick>> {
  const reads = useQueries({ queries: ownEntryIds.map((entryId) => gamePicksQueryOptions(contest, entryId, weekId)) });
  return new Map(ownEntryIds.map((entryId, index) => [entryId, new Map((reads[index]?.data?.games ?? []).flatMap((game) => (game.pick ? [[game.sportEventRoundMatchId, {
    sportEventRoundMatchId: game.sportEventRoundMatchId,
    sportEventParticipantId: game.pick.sportEventParticipantId,
    outcome: game.pick.outcome ?? PickOutcome.PENDING,
  }] as const] : [])))]));
}

/**
 * A pick'em contest's season leaderboard (#718, #1751): each entry's season total, then its
 * picks right in each week, newest first, with 🥇🥈🥉 for each week's top three and a peek on its
 * place and misses. Opening an entry lists the current week's games, each with the entry's pick
 * marked right or missed under the week's column; another entry's pick shows from its game's
 * kickoff. The Entry column stays put while older weeks scroll sideways. Polled while the
 * contest is live, so counts and places move with the results.
 */
export function PickEmLeaderboard({ contest }: { contest: ContestDto }) {
  const contestId = contest.id;
  const displayPreferences = useDisplayPreferences();
  const leaderboardQuery = usePickEmLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);
  const mySquadId = viewer.mySquadId;
  const board = leaderboardQuery.data;
  const currentWeek = board?.weeks.find((week) => week.sportEventId === board.currentWeekId) ?? null;
  const currentWeekId = currentWeek?.started ? currentWeek.sportEventId : '';
  const gamesQuery = useLeaderboardEventGames(currentWeekId, contest.status, currentWeekId !== '');
  const namesQuery = useQuery({ ...eventFieldQueryOptions(currentWeekId), select: teamNamesOf });
  const ownEntryIds = (board?.entries ?? []).filter(isMySquadsEntry(mySquadId)).map((entry) => entry.entryId);
  const ownPicks = useOwnWeekPicks(contest, currentWeekId ? ownEntryIds : [], currentWeekId);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'pickEmLeaderboard.load.failed', contestId });

  if (fallback || !board) {
    return fallback;
  }

  const isUnderWay = board.weeks.some((week) => week.started);
  const names = namesQuery.data;
  const teamName = teamNameIn(names ?? new Map<string, string>(), reportMissingTeam(currentWeekId));
  const games = names ? pickEmBoardGames(gamesQuery.data ?? [], teamName, (startsAt) => formatDateTimeDisplay(startsAt, displayPreferences)) : [];

  const details = (entry: PickEmRow): SeasonWeeksDetail[] => {
    if (!currentWeek) {
      return [];
    }
    const shown = new Map(entry.currentWeekPicks.map((pick) => [pick.sportEventRoundMatchId, pick]));
    const own = ownPicks.get(entry.entryId);
    return games.map((game) => {
      const pick = shown.get(game.id) ?? own?.get(game.id);
      return {
        id: game.id,
        testId: `${TEST_ID}-game-${game.id}-${entry.entryId}`,
        entry: (
          <span className="block min-w-0">
            <Text as="span" className="block truncate" size="inherit" weight="semibold">{game.matchup}</Text>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <Text as="span" className="truncate" tone="muted" variant="caption">{game.progress}</Text>
              <EventScheduleChip status={game.status} testId={`${TEST_ID}-game-${game.id}-${entry.entryId}-schedule`} />
            </span>
          </span>
        ),
        weeks: pick ? {
          [currentWeek.sportEventId]: <PickCell label={pickLabel(pick.sportEventParticipantId, teamName)} pick={pick} testId={`${TEST_ID}-pick-${game.id}-${entry.entryId}`} />,
        } : {},
      };
    });
  };

  return (
    <LeaderboardFrame
      contest={contest}
      finalRows={board.entries.map((entry) => ({
        entryName: entry.entryName,
        isMine: isMySquadsEntry(mySquadId)(entry),
        position: entry.position,
        score: formatPoints(entry.totalPoints),
      }))}
      isUnscored={board.entries.length > 0 && board.entries.every((entry) => entry.weeks.every((week) => !week.correctPickCount))}
      leagueCode={leagueCode}
      notes={isUnderWay ? null : (
        <p data-testid="pick-em-leaderboard-not-started">Points show from the first kickoff. Entries are listed once they submit a week.</p>
      )}
      summary={(
        <span data-testid="pick-em-leaderboard-mode">{formatPickEmRulesName(board)}</span>
      )}
    >
      <SeasonWeeksGrid
        board={{ contestId, leagueCode, leagueId: contest.leagueId, mySquadId }}
        currentWeek={{ id: board.currentWeekId, isLive: Boolean(currentWeek?.started && !currentWeek.settled) }}
        data={board.entries}
        details={currentWeekId ? details : undefined}
        emptyMessage="No entry has submitted a week yet."
        summaryColumns={[totalColumn<PickEmRow>(TEST_ID, { format: formatPoints, header: 'Season', id: 'total', value: (row) => row.totalPoints })]}
        testIdPrefix={TEST_ID}
        trailing={<YourBestNote entries={board.entries} mySquadId={mySquadId} points={(entry) => entry.totalPoints} testId="pick-em-leaderboard-my-best" />}
        weekCell={(entry, week) => <WeekCell entry={entry} week={week} />}
        weekHeading={weekHeading}
        weekId={(week) => week.sportEventId}
        weeks={pickEmShownWeeks(board)}
      />
    </LeaderboardFrame>
  );
}
