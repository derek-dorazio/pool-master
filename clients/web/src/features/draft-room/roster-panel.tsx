import { Badge } from '@/components/ui/badge';
import type { DraftState, DraftPick } from './hooks/use-draft';

export function RosterPanel({ draft }: { draft: DraftState }) {
  const myEntry = draft.entries.find((e) => e.userId === 'me');
  const myPicks = draft.picks.filter((p) => p.entryId === myEntry?.id);

  // Group by position
  const byPosition = new Map<string, DraftPick[]>();
  for (const pick of myPicks) {
    const pos = pick.position ?? 'Other';
    const existing = byPosition.get(pos) ?? [];
    existing.push(pick);
    byPosition.set(pos, existing);
  }

  const totalSlots = draft.totalRounds;
  const filledSlots = myPicks.length;

  return (
    <div className="flex flex-col h-full border-l">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">My Roster</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Picks: {filledSlots} / {totalSlots}
        </p>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(filledSlots / totalSlots) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {byPosition.size === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No picks yet. Select players from the available list.
          </p>
        ) : (
          Array.from(byPosition.entries()).map(([position, picks]) => (
            <div key={position}>
              <h4 className="text-xs font-medium text-muted-foreground mb-1.5">{position}</h4>
              <div className="space-y-1">
                {picks.map((pick) => (
                  <div
                    key={pick.pickNumber}
                    className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pick.participantName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {pick.team} &middot; Rd {pick.round}, Pick #{pick.pickNumber}
                      </p>
                    </div>
                    {pick.autoPicked && (
                      <Badge variant="outline" className="text-[10px] shrink-0">Auto</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {/* Empty slots */}
        {filledSlots < totalSlots && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Open Slots</h4>
            <div className="space-y-1">
              {Array.from({ length: Math.min(3, totalSlots - filledSlots) }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground/50"
                >
                  —
                </div>
              ))}
              {totalSlots - filledSlots > 3 && (
                <p className="text-[10px] text-muted-foreground text-center">
                  +{totalSlots - filledSlots - 3} more slots
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
