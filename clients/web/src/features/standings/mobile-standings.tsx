import { useState } from 'react';
import { ChevronDown, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileStandingsEntry {
  id: string;
  rank: number;
  entryName: string;
  ownerName: string;
  totalScore: number;
  movement: 'up' | 'down' | 'none';
  movementAmount: number;
  isCurrentUser: boolean;
  isEliminated: boolean;
  roundScores: Record<string, number>;
}

interface MobileStandingsProps {
  entries: MobileStandingsEntry[];
  roundLabels: string[];
}

/**
 * Mobile-optimized standings view. Shows rank, name, and score in a compact
 * three-column layout. Tap to expand and see round-by-round detail.
 */
export function MobileStandings({ entries, roundLabels }: MobileStandingsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="divide-y lg:hidden">
      {entries.map((entry) => {
        const isExpanded = expandedId === entry.id;

        return (
          <div key={entry.id}>
            <button
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                entry.isCurrentUser && 'bg-primary/5',
                entry.isEliminated && 'opacity-50',
              )}
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
            >
              {/* Rank */}
              <div className="w-8 shrink-0">
                {entry.rank <= 3 ? (
                  <span className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                    entry.rank === 1 && 'bg-yellow-100 text-yellow-700',
                    entry.rank === 2 && 'bg-gray-200 text-gray-700',
                    entry.rank === 3 && 'bg-amber-100 text-amber-700',
                  )}>
                    {entry.rank}
                  </span>
                ) : (
                  <span className="text-sm font-medium">{entry.rank}</span>
                )}
              </div>

              {/* Name + movement */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn('text-sm font-medium truncate', entry.isEliminated && 'line-through')}>
                    {entry.entryName}
                  </span>
                  {entry.isCurrentUser && (
                    <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">You</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{entry.ownerName}</span>
                  {entry.movement !== 'none' && (
                    <span className={cn('flex items-center gap-0.5', entry.movement === 'up' ? 'text-green-600' : 'text-red-600')}>
                      {entry.movement === 'up' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      {entry.movementAmount}
                    </span>
                  )}
                </div>
              </div>

              {/* Score + expand indicator */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono font-medium tabular-nums">{entry.totalScore}</span>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
              </div>
            </button>

            {/* Expanded round detail */}
            {isExpanded && (
              <div className="bg-muted/30 px-4 py-3 grid grid-cols-2 gap-2 text-sm">
                {roundLabels.map((label) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}:</span>
                    <span className="font-mono tabular-nums">{entry.roundScores[label] ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
