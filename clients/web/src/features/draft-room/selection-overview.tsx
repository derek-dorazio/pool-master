import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DraftState } from './hooks/use-draft';

export function SelectionOverview({ draft }: { draft: DraftState }) {
  const isBudgetPick = draft.selectionType === 'BUDGET_PICK';
  const totalBudget = isBudgetPick && typeof draft.selectionConfig?.budget === 'number'
    ? draft.selectionConfig.budget
    : null;

  const progressRows = draft.entries.map((entry) => {
    const entryPicks = draft.picks.filter((pick) => pick.entryId === entry.id);
    const pickCount = entryPicks.length;
    const spent = entryPicks.reduce((sum, pick) => sum + (pick.price ?? 0), 0);
    return {
      entryId: entry.id,
      entryName: entry.name,
      pickCount,
      spent,
    };
  });

  const mySpent = draft.myEntryId
    ? progressRows.find((row) => row.entryId === draft.myEntryId)?.spent ?? 0
    : 0;
  const myRemaining = totalBudget != null ? Math.max(totalBudget - mySpent, 0) : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      {totalBudget != null ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Budget Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Budget</span>
              <span>${totalBudget.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Spent</span>
              <span>${mySpent.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Remaining</span>
              <span>${(myRemaining ?? 0).toLocaleString()}</span>
            </div>
            {draft.selectionConfig?.pricingMethod ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pricing</span>
                <span>{draft.selectionConfig.pricingMethod}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{isBudgetPick ? 'Entry Progress' : 'Selection Progress'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {progressRows.map((row) => (
            <div key={row.entryId}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{row.entryName}</span>
                <div className="text-right text-muted-foreground">
                  <div>{row.pickCount} / {draft.rosterSize}</div>
                  {totalBudget != null ? <div>${row.spent.toLocaleString()} spent</div> : null}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${draft.rosterSize > 0 ? (row.pickCount / draft.rosterSize) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contest State</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Selection Type</span>
            <span>{draft.selectionType}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Entries</span>
            <span>{draft.entries.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Picks Made</span>
            <span>{draft.picks.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pool Remaining</span>
            <span>{draft.availableParticipantIds.length}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
