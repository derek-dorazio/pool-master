import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trophy,
  ArrowUp,
  ArrowDown,
  Minus,
  BarChart3,
  List,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getSelectionConfigDetailRows } from '@/features/contests/selection-config-summary';
import { client, getMyStandingsEntry, getStandingsSummary } from '@/lib/api';
import { useContest } from '@/features/contests/hooks/use-contest';
import { PreDraftView } from '@/features/contests/pre-draft-view';
import { toast } from '@/hooks/use-toast';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestEntryListResponseSchema,
  MyContestEntryResponseSchema,
  MyStandingsEntryResponseSchema,
  StandingsSummaryResponseSchema,
} from '@poolmaster/shared/dto';
import { SelectionType } from '@poolmaster/shared/domain';
import { useAuthStore } from '@/stores/auth-store';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function statusLabel(status: string) {
  switch (status) {
    case 'OPEN':
      return 'Open';
    case 'DRAFT':
      return 'Draft';
    case 'LOCKED':
      return 'Locked';
    case 'ACTIVE':
      return 'In Progress';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

function StatusBadge({ status }: { status: string }) {
  const label = statusLabel(status);
  const colors: Record<string, string> = {
    Open: 'bg-blue-100 text-blue-800',
    Draft: 'bg-amber-100 text-amber-800',
    Locked: 'bg-orange-100 text-orange-800',
    'In Progress': 'bg-green-100 text-green-800',
    Completed: 'bg-gray-100 text-gray-800',
    Cancelled: 'bg-red-100 text-red-800',
  };
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', colors[label] ?? 'bg-muted text-muted-foreground')}>
      {label}
    </span>
  );
}

function MovementIcon({ movement }: { movement: 'up' | 'down' | 'same' | 'new' }) {
  if (movement === 'up') return <ArrowUp className="h-4 w-4 text-green-600" />;
  if (movement === 'down') return <ArrowDown className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function getContestRoomLabel(selectionType: string) {
  switch (selectionType) {
    case SelectionType.SNAKE_DRAFT:
      return 'Open Draft Room';
    case SelectionType.PICK_EM:
      return "Open Pick'em Room";
    case SelectionType.BRACKET_PICK_EM:
      return 'Open Bracket Room';
    case SelectionType.BUDGET_PICK:
      return 'Open Budget Room';
    case SelectionType.TIERED:
      return 'Open Tiered Room';
    case SelectionType.OPEN_SELECTION:
      return 'Open Selection Room';
    default:
      return 'Open Contest Room';
  }
}

function getContestDetailCopy(selectionType: string) {
  switch (selectionType) {
    case SelectionType.PICK_EM:
      return {
        standingsTitle: "Pick'em Standings Snapshot",
        standingsLinkLabel: "View full pick'em standings",
        myEntryTitle: "My Pick'em Entry",
        currentRankLabel: "Current Prediction Rank",
        totalScoreLabel: 'Prediction Score',
        entryNameLabel: 'Prediction Name',
        snapshotEntryLabel: 'Prediction',
        snapshotScoreLabel: 'Prediction Score',
        countLabel: 'predictions',
      };
    case SelectionType.BRACKET_PICK_EM:
      return {
        standingsTitle: 'Bracket Standings Snapshot',
        standingsLinkLabel: 'View full bracket standings',
        myEntryTitle: 'My Bracket Entry',
        currentRankLabel: 'Current Bracket Rank',
        totalScoreLabel: 'Bracket Score',
        entryNameLabel: 'Bracket Name',
        snapshotEntryLabel: 'Bracket',
        snapshotScoreLabel: 'Bracket Score',
        countLabel: 'brackets',
      };
    default:
      return {
        standingsTitle: 'Standings Snapshot',
        standingsLinkLabel: 'View full standings',
        myEntryTitle: 'My Entry',
        currentRankLabel: 'Current Rank',
        totalScoreLabel: 'Total Score',
        entryNameLabel: 'Entry Name',
        snapshotEntryLabel: 'Entry',
        snapshotScoreLabel: 'Score',
        countLabel: 'entries',
      };
  }
}

function getSelectionTypeLabel(selectionType: string) {
  switch (selectionType) {
    case SelectionType.SNAKE_DRAFT:
      return 'Snake Draft';
    case SelectionType.PICK_EM:
      return "Pick'em";
    case SelectionType.BRACKET_PICK_EM:
      return "Bracket Pick'em";
    case SelectionType.BUDGET_PICK:
      return 'Budget Pick';
    case SelectionType.TIERED:
      return 'Tiered';
    case SelectionType.OPEN_SELECTION:
      return 'Open Selection';
    default:
      return selectionType;
  }
}

function getContestTypeLabel(contestType: string) {
  switch (contestType) {
    case 'SINGLE_EVENT':
      return 'Single Event';
    default:
      return contestType;
  }
}

function getScoringEngineLabel(scoringEngine: string) {
  switch (scoringEngine) {
    case 'ADVANCEMENT':
      return 'Advancement';
    case 'STAT_ACCUMULATION':
      return 'Stat Accumulation';
    case 'STROKE_PLAY':
      return 'Stroke Play';
    case 'POSITION':
      return 'Position';
    case 'BRACKET':
      return 'Bracket';
    case 'FIGHT_RESULT':
      return 'Fight Result';
    case 'CUMULATIVE':
      return 'Cumulative';
    default:
      return scoringEngine;
  }
}

export function Component() {
  const { contestId } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { data: contestData, isLoading } = useContest(contestId);
  const isPreDraftContest = contestData?.contest.status === 'DRAFT' || contestData?.contest.status === 'OPEN';

  const { data: contestEntries } = useQuery({
    queryKey: ['contests', contestId, 'entries'],
    queryFn: async () => {
      const { data, error } = await client.get({
        url: API_ROUTES.contests.entries(contestId!),
      });
      if (error) throw error;
      return ContestEntryListResponseSchema.parse(data);
    },
    enabled: !!contestId && isPreDraftContest,
  });

  const { data: myContestEntry } = useQuery({
    queryKey: ['contests', contestId, 'my-entry'],
    queryFn: async () => {
      const { data, error } = await client.get({
        url: API_ROUTES.contests.myEntry(contestId!),
      });
      if (error) throw error;
      return MyContestEntryResponseSchema.parse(data);
    },
    enabled: !!contestId,
  });

  const enterContest = useMutation({
    mutationFn: async () => {
      const { data, error } = await client.post({
        url: API_ROUTES.contests.myEntry(contestId!),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast({ title: 'Contest entered', description: 'Your contest entry is ready.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'entries'] }),
        queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'my-entry'] }),
        queryClient.invalidateQueries({ queryKey: ['contests', contestId] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: 'Unable to enter contest',
        description: getErrorMessage(error, 'We could not create your contest entry.'),
      });
    },
  });

  const leaveContest = useMutation({
    mutationFn: async () => {
      const { error } = await client.delete({
        url: API_ROUTES.contests.myEntry(contestId!),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: 'Left contest', description: 'Your contest entry was removed.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'entries'] }),
        queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'my-entry'] }),
        queryClient.invalidateQueries({ queryKey: ['contests', contestId] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: 'Unable to leave contest',
        description: getErrorMessage(error, 'We could not remove your contest entry.'),
      });
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['contests', contestId, 'standings-summary'],
    queryFn: async () => {
      const { data, error } = await getStandingsSummary({
        client,
        path: { contestId: contestId! },
      });
      if (error) throw error;
      return StandingsSummaryResponseSchema.parse(data);
    },
    enabled: !!contestId && !isPreDraftContest,
  });

  const { data: myEntry } = useQuery({
    queryKey: ['contests', contestId, 'my-standings-entry'],
    queryFn: async () => {
      const { data, error } = await getMyStandingsEntry({
        client,
        path: { contestId: contestId! },
      });
      if (error) throw error;
      return MyStandingsEntryResponseSchema.parse(data);
    },
    enabled: !!contestId && !isPreDraftContest,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!contestData) {
    return <p className="text-muted-foreground">Contest not found.</p>;
  }

  const contest = contestData.contest;
  const joinedEntry = myContestEntry?.entry;
  const copy = getContestDetailCopy(contest.selectionType);
  const selectionTypeLabel = getSelectionTypeLabel(contest.selectionType);
  const contestTypeLabel = getContestTypeLabel(contest.contestType);
  const scoringEngineLabel = getScoringEngineLabel(contest.scoringEngine);
  const selectionDetailRows = getSelectionConfigDetailRows(contestData.selectionConfig);

  if (isPreDraftContest && contest) {
    return (
      <div className="space-y-6">
        <PreDraftView
          contest={contest}
          selectionConfig={contestData.selectionConfig}
          entryMeta={{
            currentEntries: contestEntries?.total ?? contest.entryCount ?? 0,
            entries: (contestEntries?.entries ?? []).map((entry) => ({
              id: entry.id,
              name: entry.name,
              ownerName: entry.ownerDisplayName,
            })),
          }}
          joinMeta={{
            isJoined: contestEntries?.isJoined ?? joinedEntry != null,
          }}
          onJoin={joinedEntry ? undefined : () => void enterContest.mutateAsync()}
          isJoining={enterContest.isPending}
        />

        {joinedEntry ? (
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to={`/drafts/${contest.id}`}>
                {getContestRoomLabel(contest.selectionType)}
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void leaveContest.mutateAsync()}
              disabled={leaveContest.isPending}
            >
              {leaveContest.isPending ? 'Leaving...' : 'Leave Contest'}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter this contest to create your entry and unlock the live draft or selection room.
          </p>
        )}

        {user && joinedEntry && (
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.displayName}</span> with entry{' '}
            <span className="font-medium text-foreground">{joinedEntry.name}</span>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{contest.name}</h1>
            <StatusBadge status={contest.status} />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
              {contest.sport ?? 'Sport unavailable'}
            </span>
            <span>&middot;</span>
            <span>{selectionTypeLabel}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            League:{' '}
            <Link to={`/leagues/${contest.leagueId}`} className="text-primary hover:underline">
              {contest.leagueId}
            </Link>
            <span className="ml-2">&middot; {summary?.totalEntries ?? contest.entryCount ?? 0} {copy.countLabel}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/contests/${contestId}/scoring`}>
              <BarChart3 className="mr-2 h-4 w-4" />
              View Scoring
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/contests/${contestId}/standings`}>
              <List className="mr-2 h-4 w-4" />
              Full Standings
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                {copy.myEntryTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {myEntry ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{copy.currentRankLabel}</p>
                      <p className="text-2xl font-bold">
                        {myEntry.entry.rank}
                        <span className="text-base font-normal text-muted-foreground">
                          {' '}of {myEntry.totalEntries}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">{copy.totalScoreLabel}</p>
                      <p className="text-2xl font-bold">{myEntry.entry.totalScore}</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{copy.entryNameLabel}</span>
                      <span className="font-medium">{myEntry.entry.entryName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Owner</span>
                      <span className="font-medium">{myEntry.entry.ownerDisplayName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Previous Rank</span>
                      <span className="font-medium">{myEntry.entry.previousRank ?? '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Movement</span>
                      <span className="font-medium capitalize">{myEntry.entry.movement}</span>
                    </div>
                  </div>
                </>
              ) : joinedEntry ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{copy.myEntryTitle}</p>
                      <p className="text-2xl font-bold">{joinedEntry.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Owner</p>
                      <p className="text-lg font-semibold">{joinedEntry.ownerDisplayName}</p>
                    </div>
                  </div>

                  <Separator />

                  <p className="text-sm text-muted-foreground">
                    Your entry is registered, but standings have not been generated for this contest yet.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You do not have a contest entry for this contest yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{copy.standingsTitle}</CardTitle>
              <Link
                to={`/contests/${contestId}/standings`}
                className="text-sm text-primary hover:underline"
              >
                {copy.standingsLinkLabel}
              </Link>
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2 text-left font-medium">Rank</th>
                        <th className="w-8 px-2 py-2" />
                        <th className="px-4 py-2 text-left font-medium">{copy.snapshotEntryLabel}</th>
                        <th className="px-4 py-2 text-right font-medium">{copy.snapshotScoreLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topEntries.map((entry) => (
                        <tr
                          key={entry.entryId}
                          className={cn(
                            'border-b last:border-0',
                            myEntry?.entry.entryId === entry.entryId && 'bg-primary/5',
                          )}
                        >
                          <td className="px-4 py-2 font-medium">{entry.rank}</td>
                          <td className="px-2 py-2">
                            <MovementIcon movement={entry.movement} />
                          </td>
                          <td className="px-4 py-2">
                            <p className="font-medium">{entry.entryName}</p>
                            <p className="text-xs text-muted-foreground">{entry.ownerDisplayName}</p>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-medium">{entry.totalScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Standings summary is unavailable for this contest.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Contest Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Contest Type', value: contestTypeLabel },
                { label: 'Selection', value: selectionTypeLabel },
                { label: 'Scoring Engine', value: scoringEngineLabel },
                { label: 'Starts', value: contest.startsAt ? new Date(contest.startsAt).toLocaleString() : 'Not scheduled' },
                { label: 'Ends', value: contest.endsAt ? new Date(contest.endsAt).toLocaleString() : 'Not scheduled' },
                { label: 'Locks', value: contest.lockAt ? new Date(contest.lockAt).toLocaleString() : 'No lock time' },
                ...selectionDetailRows,
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className="text-sm font-medium text-right">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
