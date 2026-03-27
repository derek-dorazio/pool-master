import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DraftState, DraftPick, DraftEntry } from './hooks/use-draft';

const positionColors: Record<string, string> = {
  QB: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  RB: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  WR: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  TE: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  K: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  DEF: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export function PickBoard({ draft }: { draft: DraftState }) {
  const { entries, picks, currentPickNumber, totalRounds, currentRound } = draft;

  // Build the grid: rounds x entries
  const pickMap = new Map<string, DraftPick>();
  for (const pick of picks) {
    pickMap.set(`${pick.round}-${pick.entryId}`, pick);
  }

  // Generate pick order per round (snake: reverse every other round)
  function getEntryOrder(round: number): DraftEntry[] {
    return round % 2 === 1 ? [...entries] : [...entries].reverse();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Current pick banner */}
      {draft.status === 'LIVE' && (
        <div
          className={cn(
            'px-4 py-2 text-center text-sm font-medium border-b',
            draft.isMyPick
              ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
              : 'bg-muted',
          )}
        >
          {draft.isMyPick
            ? "It's YOUR pick! Select a player from the available list."
            : `Waiting for ${draft.currentEntryName ?? 'next pick'}...`}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3">
        <div className="min-w-max">
          {/* Header row with team names */}
          <div className="flex sticky top-0 z-10 bg-background border-b">
            <div className="w-16 shrink-0 px-2 py-1.5 text-xs font-medium text-muted-foreground">Rd</div>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="w-28 shrink-0 px-2 py-1.5 text-xs font-medium truncate text-center"
              >
                {entry.name}
              </div>
            ))}
          </div>

          {/* Rounds */}
          {Array.from({ length: Math.min(totalRounds, currentRound + 2) }).map((_, roundIdx) => {
            const round = roundIdx + 1;
            const orderedEntries = getEntryOrder(round);
            const isCurrentRound = round === currentRound;
            const isSnakeReverse = round % 2 === 0;

            return (
              <div
                key={round}
                className={cn('flex border-b', isCurrentRound && 'bg-primary/5')}
              >
                <div className="w-16 shrink-0 px-2 py-2 text-xs text-muted-foreground flex items-center gap-1">
                  {round}
                  {isSnakeReverse && <span className="text-[10px]">&#8592;</span>}
                  {!isSnakeReverse && <span className="text-[10px]">&#8594;</span>}
                </div>
                {entries.map((entry) => {
                  const pick = pickMap.get(`${round}-${entry.id}`);
                  const pickNum = orderedEntries.indexOf(entry) + 1 + (round - 1) * entries.length;
                  const isCurrent = pickNum === currentPickNumber && draft.status === 'LIVE';

                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        'w-28 shrink-0 px-1.5 py-1.5 border-l',
                        isCurrent && 'ring-2 ring-primary ring-inset bg-primary/10',
                      )}
                    >
                      {pick ? (
                        <div className="text-center">
                          <p className="text-xs font-medium truncate">{pick.participantName}</p>
                          <div className="flex items-center justify-center gap-1 mt-0.5">
                            {pick.position && (
                              <Badge
                                variant="outline"
                                className={cn('text-[9px] px-1 py-0', positionColors[pick.position])}
                              >
                                {pick.position}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">{pick.team}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-xs text-muted-foreground/40">
                          {isCurrent ? '...' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
