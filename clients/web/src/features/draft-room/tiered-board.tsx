import { DraftStatus } from '@poolmaster/shared/domain/enums';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DraftState, DraftPick } from './hooks/use-draft';

interface TierConfig {
  tierId: string;
  tierName: string;
  tierNumber: number;
  picksFromTier: number;
}

interface TieredBoardProps {
  draft: DraftState;
  tiers: TierConfig[];
}

const tierColors = [
  'border-l-amber-500',
  'border-l-blue-500',
  'border-l-green-500',
  'border-l-purple-500',
  'border-l-orange-500',
];

export function TieredBoard({ draft, tiers }: TieredBoardProps) {
  const { entries, picks, currentPickNumber } = draft;

  const pickMap = new Map<string, DraftPick>();
  for (const pick of picks) {
    pickMap.set(`${pick.round}-${pick.entryId}`, pick);
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-3">
      {tiers.map((tier, tierIdx) => (
        <div key={tier.tierId} className="mb-6">
          {/* Tier header */}
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-1 h-5 rounded ${tierColors[tierIdx % tierColors.length].replace('border-l-', 'bg-')}`} />
            <h3 className="text-sm font-semibold">{tier.tierName}</h3>
            <Badge variant="outline" className="text-xs">
              {tier.picksFromTier} pick{tier.picksFromTier !== 1 ? 's' : ''} per team
            </Badge>
          </div>

          {/* Grid for this tier */}
          <div className="min-w-max">
            {/* Team headers */}
            <div className="flex">
              <div className="w-12 shrink-0" />
              {entries.map((entry) => (
                <div key={entry.id} className="w-28 shrink-0 px-1 text-xs font-medium text-center truncate">
                  {entry.name}
                </div>
              ))}
            </div>

            {/* Pick slots within this tier */}
            {Array.from({ length: tier.picksFromTier }).map((_, slotIdx) => {
              const round = tiers.slice(0, tierIdx).reduce((sum, t) => sum + t.picksFromTier, 0) + slotIdx + 1;

              return (
                <div key={slotIdx} className="flex border-b">
                  <div className="w-12 shrink-0 px-2 py-1.5 text-xs text-muted-foreground">
                    {slotIdx + 1}
                  </div>
                  {entries.map((entry) => {
                    const pick = pickMap.get(`${round}-${entry.id}`);
                    const pickNum = (round - 1) * entries.length + entries.indexOf(entry) + 1;
                    const isCurrent = pickNum === currentPickNumber && draft.status === DraftStatus.LIVE;

                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          `w-28 shrink-0 px-1.5 py-1.5 border-l border-l-2 ${tierColors[tierIdx % tierColors.length]}`,
                          isCurrent && 'ring-2 ring-primary ring-inset bg-primary/10',
                        )}
                      >
                        {pick ? (
                          <div className="text-center">
                            <p className="text-xs font-medium truncate">{pick.participantName}</p>
                            <p className="text-[10px] text-muted-foreground">{pick.position} {pick.team}</p>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-muted-foreground/30">
                            {isCurrent ? '...' : '—'}
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
      ))}
    </div>
  );
}

/** Tier slot summary for the roster panel */
export function TierSlotSummary({ tiers, myPicks }: { tiers: TierConfig[]; myPicks: DraftPick[] }) {
  return (
    <div className="space-y-1.5">
      {tiers.map((tier, idx) => {
        // Count picks in this tier (simplified — in real app, picks would have tier assignment)
        const tierPicks = Math.min(myPicks.length, tier.picksFromTier);
        return (
          <div key={tier.tierId} className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${tierColors[idx % tierColors.length].replace('border-l-', 'bg-')}`} />
            <span className="text-xs">{tier.tierName}:</span>
            <span className="text-xs text-muted-foreground">{tierPicks} / {tier.picksFromTier}</span>
          </div>
        );
      })}
    </div>
  );
}
