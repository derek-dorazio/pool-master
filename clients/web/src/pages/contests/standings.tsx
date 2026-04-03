import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUp, ArrowDown, Minus, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { useStandings } from '@/features/contests/hooks/use-standings';
import type { StandingEntryDto } from '@poolmaster/shared/dto';

type SortKey = 'rank' | 'totalScore' | 'entryName';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-100 text-xs font-bold text-yellow-700">1</span>;
  if (rank === 2) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">2</span>;
  if (rank === 3) return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">3</span>;
  return <span className="text-sm font-medium">{rank}</span>;
}

function movementAmount(entry: StandingEntryDto): number {
  if (entry.previousRank == null) return 0;
  return Math.abs(entry.previousRank - entry.rank);
}

function MovementCell({ entry }: { entry: StandingEntryDto }) {
  const amount = movementAmount(entry);

  if (entry.movement === 'up') {
    return (
      <span className="flex items-center gap-0.5 text-green-600">
        <ArrowUp className="h-3.5 w-3.5" />
        <span className="text-xs">{amount}</span>
      </span>
    );
  }
  if (entry.movement === 'down') {
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
  descending,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  descending: boolean;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={cn(
        'cursor-pointer select-none px-4 py-2 font-medium hover:text-primary',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-xs">{descending ? '▼' : '▲'}</span>}
      </span>
    </th>
  );
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);
  const { data: standingsResponse, isLoading, isError, error } = useStandings(contestId);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [descending, setDescending] = useState(false);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setDescending((current) => !current);
      return;
    }
    setSortKey(key);
    setDescending(key !== 'rank');
  }

  const sorted = standingsResponse
    ? [...standingsResponse.standings].sort((a, b) => {
        if (sortKey === 'entryName') {
          const result = a.entryName.localeCompare(b.entryName);
          return descending ? -result : result;
        }

        const result = sortKey === 'rank'
          ? a.rank - b.rank
          : a.totalScore - b.totalScore;
        return descending ? -result : result;
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

  if (isError) {
    const message = error instanceof Error ? error.message : 'Standings are unavailable right now.';
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/contests/${contestId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Contest
          </Link>
        </Button>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-2xl font-bold">Standings unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {message}
            </p>
          </CardContent>
        </Card>
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
          Standings{contest ? ` — ${contest.contest.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {standingsResponse?.total ?? 0} entries ranked by the latest standings rollup
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <SortHeader label="Rank" sortKey="rank" currentSort={sortKey} descending={descending} onSort={handleSort} />
                  <th className="w-10 px-2 py-2" />
                  <SortHeader label="Entry" sortKey="entryName" currentSort={sortKey} descending={descending} onSort={handleSort} />
                  <th className="px-4 py-2 text-left font-medium">Owner</th>
                  <SortHeader label="Total" sortKey="totalScore" currentSort={sortKey} descending={descending} onSort={handleSort} align="right" />
                  <th className="px-4 py-2 text-right font-medium">Previous</th>
                  <th className="px-4 py-2 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.entryId}
                    className={cn(
                      'border-b last:border-0 transition-colors',
                      entry.isEliminated && 'opacity-50',
                    )}
                  >
                    <td className="px-4 py-3">
                      <RankBadge rank={entry.rank} />
                    </td>
                    <td className="px-2 py-3">
                      <MovementCell entry={entry} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(entry.isEliminated && 'line-through')}>
                        {entry.entryName}
                      </span>
                      {entry.isEliminated && (
                        <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          Eliminated
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.ownerDisplayName}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{entry.totalScore}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {entry.previousRank ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {new Date(entry.lastUpdatedAt).toLocaleString()}
                    </td>
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
