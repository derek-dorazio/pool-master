import { Link, useParams } from 'react-router-dom';
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
import { useContest } from '@/features/contests/hooks/use-contest';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Open: 'bg-blue-100 text-blue-800',
    Drafting: 'bg-amber-100 text-amber-800',
    'In Progress': 'bg-green-100 text-green-800',
    Completed: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', colors[status] ?? 'bg-muted text-muted-foreground')}>
      {status}
    </span>
  );
}

function MovementIcon({ movement }: { movement: 'up' | 'down' | 'none' }) {
  if (movement === 'up') return <ArrowUp className="h-4 w-4 text-green-600" />;
  if (movement === 'down') return <ArrowDown className="h-4 w-4 text-red-600" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest, isLoading } = useContest(contestId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!contest) {
    return <p className="text-muted-foreground">Contest not found.</p>;
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
              {contest.sportEmoji} {contest.sport}
            </span>
            <span>&middot;</span>
            <span>{contest.eventName}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            League:{' '}
            <Link to={`/leagues/${contest.leagueId}`} className="text-primary hover:underline">
              {contest.leagueName}
            </Link>
            <span className="ml-2">&middot; {contest.totalEntries} entries</span>
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
                My Entry
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Current Rank</p>
                  <p className="text-2xl font-bold">
                    {contest.myEntry.rank}
                    <span className="text-base font-normal text-muted-foreground">
                      {' '}of {contest.totalEntries}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total Score</p>
                  <p className="text-2xl font-bold">{contest.myEntry.score}</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">My Picks</p>
                {contest.myEntry.participants.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.position}</p>
                    </div>
                    <span className="text-sm font-mono font-medium">{p.score} pts</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Standings Snapshot</CardTitle>
              <Link
                to={`/contests/${contestId}/standings`}
                className="text-sm text-primary hover:underline"
              >
                View full standings
              </Link>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium">Rank</th>
                      <th className="w-8 px-2 py-2" />
                      <th className="px-4 py-2 text-left font-medium">Entry</th>
                      <th className="px-4 py-2 text-right font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contest.topEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={cn(
                          'border-b last:border-0',
                          entry.isCurrentUser && 'bg-primary/5'
                        )}
                      >
                        <td className="px-4 py-2 font-medium">{entry.rank}</td>
                        <td className="px-2 py-2">
                          <MovementIcon movement={entry.movement} />
                        </td>
                        <td className="px-4 py-2">
                          <p className="font-medium">{entry.entryName}</p>
                          <p className="text-xs text-muted-foreground">{entry.ownerName}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{entry.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                { label: 'Contest Type', value: contest.contestType },
                { label: 'Scoring', value: contest.scoringType },
                { label: 'Draft Type', value: contest.draftType },
                { label: 'Entry Deadline', value: new Date(contest.entryDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Created By', value: contest.createdBy },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className="text-sm font-medium">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
