import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ContestStatus, SportEventStatus, SurvivorWeekOutcome } from '@poolmaster/shared/domain';
import type { ContestDto, SurvivorLeaderboardResponse } from '@/lib/api';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { Chip, DataGrid, ErrorState, LoadingState, Tile, type StatusBadgeProps } from '@/features/shared/ui';
import { ApiError, extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { LEADERBOARD_ERROR_MESSAGES } from './contest-leaderboard';
import { describeSurvivorRules, pluralize } from './contest-rules';
import { ContestStatusBadge } from './contest-status-badge';
import { useBracketRoundLabel } from './use-bracket-round-label';
import { fetchContestEntries } from './use-contest-entries';
import { useSurvivorLeaderboardQuery } from './use-contest-leaderboard';

type SurvivorRow = SurvivorLeaderboardResponse['entries'][number];
type SurvivorWeek = SurvivorLeaderboardResponse['weeks'][number];

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
const PAGE_SIZE = 25;

const OUTCOME_LABELS: Record<SurvivorWeekOutcome, string> = {
  SURVIVED: 'Survived',
  ELIMINATED: 'Out',
  PENDING: 'Pending',
};

const OUTCOME_TONES: Record<SurvivorWeekOutcome, NonNullable<StatusBadgeProps['tone']>> = {
  SURVIVED: 'success',
  ELIMINATED: 'danger',
  PENDING: 'neutral',
};

/** What a week is called on the board: its event's name, or a playoff round's name (#785). */
type WeekName = (week: Pick<SurvivorWeek, 'name' | 'roundCount' | 'roundNumber'>) => string;

/**
 * A week's key on the board: its event, and its round when the event is a playoff of several
 * rounds (#785), each of which is a week.
 */
function weekKey(week: Pick<SurvivorWeek, 'roundCount' | 'roundNumber' | 'sportEventId'>): string {
  return week.roundCount > 1 ? `${week.sportEventId}-round-${week.roundNumber}` : week.sportEventId;
}

/** "In" for an entry still standing, else "Out in week 3", or in a playoff "Out in Divisional". */
function formatSurvivorStanding(entry: Pick<SurvivorRow, 'alive' | 'eliminatedInWeek'>, weeks: readonly SurvivorWeek[], weekName: WeekName): string {
  if (entry.alive || entry.eliminatedInWeek === null) {
    return 'In';
  }
  const week = weeks.find((candidate) => candidate.weekNumber === entry.eliminatedInWeek);
  return week && week.roundCount > 1 ? `Out in ${weekName(week)}` : `Out in week ${entry.eliminatedInWeek}`;
}

/** A week's column heading: its name, with how it stands once it is under way. */
function weekHeading(week: SurvivorWeek, weekName: WeekName): string {
  const name = weekName(week);
  if (week.status === SportEventStatus.CANCELLED) {
    return `${name} (cancelled)`;
  }
  return week.started ? `${name} (${week.aliveCount} in)` : name;
}

/** One entry's cell for one week: the team it picked once shown, and how the week went for it. */
function WeekCell({ entryId, week, weekId }: { entryId: string; week: SurvivorRow['weeks'][number]; weekId: string }) {
  if (week.outcome === null && week.team === null) {
    return <span data-testid={`survivor-leaderboard-week-${weekId}-${entryId}`}>—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={`survivor-leaderboard-week-${weekId}-${entryId}`}>
      {/* A pending week has a pick, kept hidden until its match starts; a week lost with no pick named had none. */}
      {week.team ?? (week.outcome === SurvivorWeekOutcome.PENDING ? 'Hidden until it starts' : 'No pick')}
      {week.outcome ? <Chip tone={OUTCOME_TONES[week.outcome]}>{OUTCOME_LABELS[week.outcome]}</Chip> : null}
    </span>
  );
}

/** The board's columns: place, the entry and its group, whether it is still in, weeks survived, then one per week. */
function survivorColumns(
  contestId: string,
  leagueCode: string | null,
  mySquadId: string | null,
  weeks: readonly SurvivorWeek[],
  weekName: WeekName,
): ColumnDef<SurvivorRow>[] {
  const cellOf = (row: SurvivorRow, week: SurvivorWeek) =>
    row.weeks.find((cell) => cell.sportEventId === week.sportEventId && cell.roundNumber === week.roundNumber);
  return [
    {
      id: 'place',
      header: 'Place',
      accessorFn: (row) => row.position,
      cell: ({ row }) => (
        <span className="font-semibold" data-testid={`survivor-leaderboard-place-${row.original.entryId}`}>
          {row.original.displayPosition}
        </span>
      ),
    },
    {
      id: 'entry',
      header: 'Entry',
      // Searched by the entry's name and its group's name.
      accessorFn: (row) => `${row.entryName} ${row.squadName}`,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            {leagueCode ? (
              <Link
                className="font-medium text-foreground hover:underline"
                data-testid={`survivor-leaderboard-entry-link-${row.original.entryId}`}
                state={{ leagueCode }}
                to={buildLeagueContestEntryPath(leagueCode, contestId, row.original.entryId)}
              >
                {row.original.entryName}
              </Link>
            ) : (
              <span className="font-medium">{row.original.entryName}</span>
            )}
            {mySquadId !== null && row.original.squadId === mySquadId ? <Chip tone="active">Yours</Chip> : null}
          </span>
          <span className="block text-xs text-muted-foreground">{row.original.squadName}</span>
        </span>
      ),
    },
    {
      id: 'standing',
      header: 'Status',
      accessorFn: (row) => formatSurvivorStanding(row, weeks, weekName),
      cell: ({ row }) => (
        <Chip data-testid={`survivor-leaderboard-standing-${row.original.entryId}`} tone={row.original.alive ? 'success' : 'neutral'}>
          {formatSurvivorStanding(row.original, weeks, weekName)}
        </Chip>
      ),
    },
    {
      id: 'survived',
      header: 'Weeks survived',
      accessorFn: (row) => row.weeksSurvived,
      cell: ({ row }) => (
        <span className="font-semibold" data-testid={`survivor-leaderboard-survived-${row.original.entryId}`}>
          {row.original.weeksSurvived}
        </span>
      ),
    },
    ...weeks.map((week): ColumnDef<SurvivorRow> => ({
      id: `week-${weekKey(week)}`,
      header: weekHeading(week, weekName),
      accessorFn: (row) => cellOf(row, week)?.outcome ?? null,
      cell: ({ row }) => {
        const cell = cellOf(row.original, week);
        return cell ? <WeekCell entryId={row.original.entryId} week={cell} weekId={weekKey(week)} /> : '—';
      },
    })),
  ];
}

/**
 * A survivor contest's leaderboard (#719): place, the entry and its group, whether it is still in
 * or the week it went out, its weeks survived, and a column for every week with the team it picked
 * (shown from that game's kickoff) and how the week went. On a playoff bracket (#785) each round
 * is a column of its own, named as the bracket names it. Polled while the contest is live, so
 * entries drop out as the results come in.
 */
export function SurvivorLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const logger = getLogger().child({ feature: 'survivor-leaderboard' });
  const contestId = contest.id;
  const leaderboardQuery = useSurvivorLeaderboardQuery(contestId, contest.status);
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contest.leagueId);
  // A playoff's rounds (#785) are named as its bracket names them.
  const playoffEventId = leaderboardQuery.data?.weeks.find((week) => week.roundCount > 1)?.sportEventId ?? '';
  const roundLabel = useBracketRoundLabel(contest.sport, playoffEventId);
  const weekName: WeekName = (week) => (week.roundCount > 1 ? roundLabel(week.roundNumber, week.roundCount) : week.name);
  const leagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;

  useEffect(() => {
    if (leaderboardQuery.isError) {
      logger.warn(
        { action: 'survivorLeaderboard.load.failed', data: { contestId }, err: leaderboardQuery.error },
        'Survivor leaderboard failed to load',
      );
    }
  }, [contestId, leaderboardQuery.error, leaderboardQuery.isError, logger]);

  if (leaderboardQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }
  if (leaderboardQuery.isError || !leaderboardQuery.data) {
    const { error } = leaderboardQuery;
    return (
      <ErrorState
        body={extractErrorMessage(error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={error instanceof ApiError && error.code ? `contest-leaderboard-error-${error.code}` : 'contest-leaderboard-error'}
        title="We couldn't load this leaderboard."
      />
    );
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;
  const stillIn = board.entries.filter((entry) => entry.alive).length;
  const isUnderWay = board.weeks.some((week) => week.started);

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <ContestHeader
        badges={<ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current="leaderboard"
            leagueCode={leagueCode}
            myEntryId={contestEntriesQuery.data?.myEntryIds?.[0] ?? null}
            picksRevealed
          />
        ) : null}
        summary={(
          <p className="mt-2 text-sm text-muted-foreground" data-testid="survivor-leaderboard-rules">
            {describeSurvivorRules(null)}
          </p>
        )}
        title={contest.name}
        titleTestId="contest-leaderboard-heading"
      >
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {board.entries.length ? (
            <p data-testid="survivor-leaderboard-still-in">{`${pluralize(stillIn, 'entry', 'entries')} still in.`}</p>
          ) : null}
          {isUnderWay ? null : (
            <p data-testid="survivor-leaderboard-not-started">Picks show from each game&apos;s kickoff. Entries are listed once they submit a week.</p>
          )}
          {contest.status === ContestStatus.COMPLETED ? (
            <p data-testid="contest-leaderboard-settled-note">Final result: these standings are frozen at settlement.</p>
          ) : null}
        </div>
      </ContestHeader>

      <Tile>
        <DataGrid
          columns={survivorColumns(contestId, leagueCode, mySquadId, board.weeks, weekName)}
          data={board.entries}
          emptyMessage="No entry has submitted a week yet."
          getRowId={(row) => row.entryId}
          pageSize={PAGE_SIZE}
          rowTestId={(row) => `survivor-leaderboard-row-${row.entryId}`}
          search={{ label: 'Find an entry', placeholder: 'Find an entry', testId: 'contest-leaderboard-search' }}
          showColumnFilters={false}
          tableTestId="survivor-leaderboard-table"
        />
      </Tile>
    </section>
  );
}
