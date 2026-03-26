import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUp, ArrowDown, Minus, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { useStandings, type StandingsEntry } from '@/features/contests/hooks/use-standings';

type SortKey = 'rank' | 'totalScore' | 'round1' | 'round2' | 'round3' | 'round4';
type SortDir = 'asc' | 'desc';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-100 text-xs font-bold text-yellow-700">1</span>;
  if (rank === 2) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">2</span>;
  if (rank === 3) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">3</span>;
  return <span className="text-sm font-medium">{rank}</span>;
}

function MovementCell({ movement, amount }: { movement: 'up' | 'down' | 'none'; amount: number }) {
  if (movement === 'up') {
    return (
      <span className="flex items-center gap-0.5 text-green-600">
        <ArrowUp className="h-3.5 w-3.5" />
        <span className="text-xs">{amount}</span>
      </span>
    );
  }
  if (movement === 'down') {
    return (
      <span className="flex items-center gap-0.5 text-red-600">
        <ArrowDown className="h-3.5 w-3.5" />
        <span className="text-xs">{amount}</span>
      </span>
    );
  }
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn(
        'cursor-pointer select-none px-4 py-2 font-medium hover:text-primary',
        align === 'right' ? 'text-right' : 'text-left'
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-xs">{currentDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  );
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);
  const { data: standings, isLoading } = useStandings(contestId);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'rank' ? 'asc' : 'desc');
    }
  }

  const sorted = standings
    ? [...standings].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      })
    : [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold">
          Standings{contest ? ` — ${contest.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {standings?.length ?? 0} entries &middot; Round 4 in progress
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <SortHeader label="Rank" sortKey="rank" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <th className="w-10 px-2 py-2" />
                  <th className="px-4 py-2 text-left font-medium">Entry</th>
                  <th className="px-4 py-2 text-left font-medium">Owner</th>
                  <SortHeader label="Total" sortKey="totalScore" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="R1" sortKey="round1" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="R2" sortKey="round2" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="R3" sortKey="round3" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  <SortHeader label="R4" sortKey="round4" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b last:border-0 transition-colors',
                      entry.isCurrentUser && 'bg-primary/5 font-medium',
                      entry.isEliminated && 'opacity-50'
                    )}
                  >
                    <td className="px-4 py-3">
                      <RankBadge rank={entry.rank} />
                    </td>
                    <td className="px-2 py-3">
                      <MovementCell movement={entry.movement} amount={entry.movementAmount} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(entry.isEliminated && 'line-through')}>
                        {entry.entryName}
                      </span>
                      {entry.isCurrentUser && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                          You
                        </span>
                      )}
                      {entry.isEliminated && (
                        <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          Eliminated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.ownerName}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{entry.totalScore}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{entry.round1}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{entry.round2}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{entry.round3}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">{entry.round4}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
