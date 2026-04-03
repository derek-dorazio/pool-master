import { Badge } from '@/components/ui/badge';
import type { DraftState, DraftPick } from './hooks/use-draft';

export function RosterPanel({ draft }: { draft: DraftState }) {
  const myPicks = draft.myEntryId
    ? draft.picks.filter((p) => p.entryId === draft.myEntryId)
    : [];
  const isBudgetPick = draft.selectionType === 'BUDGET_PICK';
  const totalBudget = isBudgetPick && typeof draft.selectionConfig?.budget === 'number'
    ? draft.selectionConfig.budget
    : null;
  const spentBudget = myPicks.reduce((sum, pick) => sum + (pick.price ?? 0), 0);
  const remainingBudget = totalBudget != null ? Math.max(totalBudget - spentBudget, 0) : null;
  const groupedPicks = new Map<string, DraftPick[]>();
  for (const pick of myPicks) {
    const group = draft.selectionType === 'TIERED'
      ? (pick.tierName ?? 'Other')
      : (pick.position ?? 'Other');
    const existing = groupedPicks.get(group) ?? [];
    existing.push(pick);
    groupedPicks.set(group, existing);
  }

  const totalSlots = draft.rosterSize;
  const filledSlots = myPicks.length;

  return (
    <div className="flex flex-col h-full border-l">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">My Roster</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Picks: {filledSlots} / {totalSlots}
        </p>
        {totalBudget != null ? (
          <p className="text-xs text-muted-foreground mt-0.5">
            Budget: ${spentBudget.toLocaleString()} / ${totalBudget.toLocaleString()} spent
          </p>
        ) : null}
        {/* Progress bar */}
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(filledSlots / totalSlots) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {groupedPicks.size === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {draft.myEntryId ? 'No picks yet. Select participants from the available list.' : 'Your contest entry is not available in this draft yet.'}
          </p>
        ) : (
          Array.from(groupedPicks.entries()).map(([group, picks]) => (
            <div key={group}>
              <h4 className="text-xs font-medium text-muted-foreground mb-1.5">{group}</h4>
              <div className="space-y-1">
                {picks.map((pick) => (
                  <div
                    key={pick.pickNumber}
                    className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pick.isSkipped ? 'Skipped Pick' : pick.participantName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {pick.isSkipped
                          ? `Rd ${pick.round}, Pick #${pick.pickNumber}`
                          : `${pick.team}${draft.selectionType === 'TIERED' ? ` · ${pick.tierName ?? 'Tier'}` : ` · Rd ${pick.round}, Pick #${pick.pickNumber}`}${isBudgetPick && typeof pick.price === 'number' ? ` · $${pick.price.toLocaleString()}` : ''}`}
                      </p>
                    </div>
                    {pick.autoPicked && (
                      <Badge variant="outline" className="text-[10px] shrink-0">Auto</Badge>
                    )}
                    {pick.isSkipped && (
                      <Badge variant="outline" className="text-[10px] shrink-0">Skipped</Badge>
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

        {remainingBudget != null ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Remaining budget: <span className="font-medium text-foreground">${remainingBudget.toLocaleString()}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
