import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface H2HParticipant {
  name: string;
  tier: string;
  score: number;
}

interface H2HEntry {
  id: string;
  entryName: string;
  ownerName: string;
  totalScore: number;
  participants: H2HParticipant[];
}

interface H2HResponse {
  entries: H2HEntry[];
}

function useH2HEntries(contestId: string | undefined) {
  return useQuery({
    queryKey: ['contest-h2h', contestId],
    queryFn: async (): Promise<H2HEntry[]> => {
      const { data, error } = await client.get<H2HResponse>({
        url: `/api/v1/contests/${contestId}/head-to-head`,
      });
      if (error) throw error;
      return data?.entries ?? [];
    },
    enabled: !!contestId,
  });
}

function EntryColumn({ entry, isWinning }: { entry: H2HEntry; isWinning: boolean }) {
  return (
    <div className="flex-1 space-y-4">
      <div className={cn('rounded-lg border p-4', isWinning && 'border-primary bg-primary/5')}>
        <p className="font-semibold">{entry.entryName}</p>
        <p className="text-sm text-muted-foreground">{entry.ownerName}</p>
        <p className="mt-2 text-2xl font-bold">{entry.totalScore}</p>
        <p className="text-xs text-muted-foreground">Total Score</p>
      </div>
      <div className="space-y-2">
        {entry.participants.map((p, i) => (
          <div key={i} className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-sm font-mono font-medium">{p.score}</span>
            </div>
            <p className="text-xs text-muted-foreground">{p.tier}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Component() {
  const { contestId } = useParams();
  const { data: entries = [] } = useH2HEntries(contestId);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  // Auto-select first two entries when data loads
  if (entries.length >= 2 && !leftId && !rightId) {
    setLeftId(entries[0].id);
    setRightId(entries[1].id);
  }

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const entryOptions = entries.map((e) => ({ id: e.id, label: `${e.entryName} (${e.ownerName})` }));
  const leftEntry = entryMap.get(leftId);
  const rightEntry = entryMap.get(rightId);
  const diff = leftEntry && rightEntry ? leftEntry.totalScore - rightEntry.totalScore : 0;

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

      <div>
        <h1 className="text-3xl font-bold">Head-to-Head</h1>
        <p className="text-sm text-muted-foreground">
          Masters 2026 Pool &middot; Compare two entries
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-center gap-4 p-4 text-center">
          <div>
            <span className="text-sm font-medium text-green-600">3 wins</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <span className="text-sm font-medium text-red-600">1 loss</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <span className="text-sm font-medium text-muted-foreground">0 ties</span>
          </div>
          <span className="text-xs text-muted-foreground">across 4 shared contests</span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="left-entry">Entry 1</label>
          <select
            id="left-entry"
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {entryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="right-entry">Entry 2</label>
          <select
            id="right-entry"
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {entryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {leftEntry && rightEntry && (
        <>
          <div className="flex items-center justify-center gap-2 text-center">
            <span className="text-sm text-muted-foreground">Score differential:</span>
            <span
              className={cn(
                'text-lg font-bold',
                diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-muted-foreground'
              )}
            >
              {diff > 0 ? '+' : ''}{diff}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <EntryColumn
              entry={leftEntry}
              isWinning={leftEntry.totalScore >= rightEntry.totalScore}
            />
            <EntryColumn
              entry={rightEntry}
              isWinning={rightEntry.totalScore >= leftEntry.totalScore}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Score Differential Chart
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-center justify-center rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Chart coming soon</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
