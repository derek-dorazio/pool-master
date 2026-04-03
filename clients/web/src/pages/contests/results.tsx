import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, ChevronLeft, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { client, getStandings } from '@/lib/api';

interface FinalEntry {
  id: string;
  rank: number;
  entryName: string;
  ownerName: string;
  totalScore: number;
  isCurrentUser: boolean;
}

interface StandingsResponse {
  standings: FinalEntry[];
  total: number;
  contestId: string;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-yellow-100 text-sm font-bold text-yellow-700">1</span>;
  if (rank === 2) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-700">2</span>;
  if (rank === 3) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">3</span>;
  return <span className="text-sm font-medium">{rank}</span>;
}

export function Component() {
  const { contestId } = useParams();

  const { data, isLoading } = useQuery({
    queryKey: ['contests', contestId, 'standings'],
    queryFn: async (): Promise<StandingsResponse> => {
      const { data, error } = await getStandings({
        client,
        path: { contestId: contestId! },
      });
      if (error) throw error;
      return {
        contestId: data?.contestId ?? contestId!,
        total: data?.total ?? 0,
        standings: (data?.standings ?? []).map((entry) => ({
          id: entry.entryId,
          rank: entry.rank,
          entryName: entry.entryName,
          ownerName: entry.ownerDisplayName,
          totalScore: entry.totalScore,
          isCurrentUser: false,
        })),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const standings = data?.standings ?? [];

  if (isLoading || standings.length < 2) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  const winner = standings[0];
  const runnerUp = standings[1];
  const margin = winner.totalScore - runnerUp.totalScore;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/contests/${contestId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Contest
          </Link>
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Contest Results</h1>
          <p className="text-sm text-muted-foreground">
            Masters 2026 Pool &middot; Final
          </p>
        </div>
        <Button variant="outline">
          <Share2 className="mr-2 h-4 w-4" />
          Share Results
        </Button>
      </div>

      <Card className="border-yellow-200 bg-gradient-to-br from-yellow-50 to-amber-50">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <Trophy className="h-8 w-8 text-yellow-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-yellow-700">Winner</p>
            <h2 className="text-2xl font-bold">{winner.entryName}</h2>
            <p className="text-muted-foreground">{winner.ownerName}</p>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <p className="text-3xl font-bold">{winner.totalScore}</p>
              <p className="text-xs text-muted-foreground">Final Score</p>
            </div>
            <Separator orientation="vertical" className="h-10" />
            <div>
              <p className="text-3xl font-bold">+{margin}</p>
              <p className="text-xs text-muted-foreground">Margin of Victory</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Final Standings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Rank</th>
                  <th className="px-4 py-2 text-left font-medium">Entry</th>
                  <th className="px-4 py-2 text-left font-medium">Owner</th>
                  <th className="px-4 py-2 text-right font-medium">Final Score</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b last:border-0 transition-colors',
                      entry.isCurrentUser && 'bg-primary/5'
                    )}
                  >
                    <td className="px-4 py-3">
                      <RankBadge rank={entry.rank} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{entry.entryName}</span>
                      {entry.isCurrentUser && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.ownerName}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{entry.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contest Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Event', value: 'The Masters 2026 — Apr 9-12' },
            { label: 'Total Entries', value: '12' },
            { label: 'Contest Type', value: 'Tiered Pick' },
            { label: 'Scoring', value: 'DFS Points' },
            { label: 'Winner', value: `${winner.entryName} (${winner.ownerName})` },
            { label: 'Winning Score', value: String(winner.totalScore) },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium">{item.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button variant="outline" asChild>
          <Link to="/leagues/league-1">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to League
          </Link>
        </Button>
      </div>
    </div>
  );
}
