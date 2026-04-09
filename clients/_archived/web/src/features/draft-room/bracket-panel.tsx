import { RotateCcw, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface BracketTeam {
  id: string;
  name: string;
  seed: number | null;
}

interface BracketMatchup {
  id: string;
  round: number;
  matchNumber: number;
  topTeam: BracketTeam | null;
  bottomTeam: BracketTeam | null;
  winnerId: string | null;
}

interface BracketPanelProps {
  matchups: BracketMatchup[];
  totalMatchups: number;
  completedPicks: number;
  championId: string | null;
  onPickWinner: (matchupId: string, winnerId: string) => void;
  onReset: () => void;
  onAutoFill: () => void;
  isLocked: boolean;
}

const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

export function BracketPanel({
  matchups,
  totalMatchups,
  completedPicks,
  championId,
  onPickWinner,
  onReset,
  onAutoFill,
  isLocked,
}: BracketPanelProps) {
  // Group matchups by round
  const rounds = new Map<number, BracketMatchup[]>();
  for (const m of matchups) {
    const existing = rounds.get(m.round) ?? [];
    existing.push(m);
    rounds.set(m.round, existing);
  }

  const sortedRounds = Array.from(rounds.entries()).sort(([a], [b]) => a - b);
  const completionPct = totalMatchups > 0 ? Math.round((completedPicks / totalMatchups) * 100) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Fill Your Bracket</h3>
          <p className="text-xs text-muted-foreground">
            {completedPicks} / {totalMatchups} picks ({completionPct}%)
          </p>
        </div>
        <div className="flex gap-1">
          {!isLocked && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAutoFill}>
                <Wand2 className="h-3 w-3 mr-1" /> Auto-fill by Seed
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onReset}>
                <RotateCcw className="h-3 w-3 mr-1" /> Reset
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3 py-2">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Bracket visualization */}
      <div className="flex-1 overflow-auto p-3">
        <div className="flex gap-6 min-w-max">
          {sortedRounds.map(([round, roundMatchups]) => (
            <div key={round} className="flex flex-col gap-4">
              <h4 className="text-xs font-medium text-center text-muted-foreground sticky top-0 bg-background py-1">
                {ROUND_NAMES[round - 1] ?? `Round ${round}`}
              </h4>

              <div className="flex flex-col gap-3" style={{ justifyContent: 'space-around', minHeight: `${roundMatchups.length * 80}px` }}>
                {roundMatchups.map((matchup) => (
                  <BracketMatchupCard
                    key={matchup.id}
                    matchup={matchup}
                    onPick={(winnerId) => onPickWinner(matchup.id, winnerId)}
                    isLocked={isLocked}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Champion */}
          <div className="flex flex-col justify-center">
            <div className="text-center p-4 border-2 border-dashed rounded-lg min-w-[120px]">
              <p className="text-xs text-muted-foreground mb-1">Champion</p>
              {championId ? (
                <p className="text-sm font-bold text-primary">
                  {matchups.find((m) => m.topTeam?.id === championId || m.bottomTeam?.id === championId)
                    ? matchups.flatMap((m) => [m.topTeam, m.bottomTeam]).find((t) => t?.id === championId)?.name
                    : '???'}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">???</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BracketMatchupCard({
  matchup,
  onPick,
  isLocked,
}: {
  matchup: BracketMatchup;
  onPick: (winnerId: string) => void;
  isLocked: boolean;
}) {
  return (
    <div className="w-40 border rounded-md overflow-hidden">
      {matchup.topTeam ? (
        <button
          onClick={() => !isLocked && matchup.topTeam && onPick(matchup.topTeam.id)}
          disabled={isLocked || !matchup.topTeam}
          className={cn(
            'w-full flex items-center justify-between px-2 py-1.5 text-xs border-b transition-colors',
            matchup.winnerId === matchup.topTeam.id
              ? 'bg-primary/10 font-medium'
              : 'hover:bg-accent',
            isLocked && 'cursor-not-allowed',
          )}
        >
          <span className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{matchup.topTeam.seed ?? '-'}</Badge>
            <span className="truncate">{matchup.topTeam.name}</span>
          </span>
          {matchup.winnerId === matchup.topTeam.id && (
            <span className="text-primary font-bold">&#10003;</span>
          )}
        </button>
      ) : (
        <div className="px-2 py-1.5 text-xs text-muted-foreground/40 border-b">TBD</div>
      )}

      {matchup.bottomTeam ? (
        <button
          onClick={() => !isLocked && matchup.bottomTeam && onPick(matchup.bottomTeam.id)}
          disabled={isLocked || !matchup.bottomTeam}
          className={cn(
            'w-full flex items-center justify-between px-2 py-1.5 text-xs transition-colors',
            matchup.winnerId === matchup.bottomTeam.id
              ? 'bg-primary/10 font-medium'
              : 'hover:bg-accent',
            isLocked && 'cursor-not-allowed',
          )}
        >
          <span className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{matchup.bottomTeam.seed ?? '-'}</Badge>
            <span className="truncate">{matchup.bottomTeam.name}</span>
          </span>
          {matchup.winnerId === matchup.bottomTeam.id && (
            <span className="text-primary font-bold">&#10003;</span>
          )}
        </button>
      ) : (
        <div className="px-2 py-1.5 text-xs text-muted-foreground/40">TBD</div>
      )}
    </div>
  );
}
