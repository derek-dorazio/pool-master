import type { ReactNode } from 'react';
import {
  IconAvatar,
  MetricGrid,
  MetricTile,
  SummaryMediaLayout,
  Tile,
} from '@/features/shared/ui';

export type LeagueSummaryCardProps = {
  activeContestCount: number;
  description?: string | null;
  icon: ReactNode;
  memberCount: number;
  name: string;
  roleLabel: string;
};

export function LeagueSummaryCard({
  activeContestCount,
  description,
  icon,
  memberCount,
  name,
  roleLabel,
}: LeagueSummaryCardProps) {
  return (
    <Tile data-testid="league-summary-tile" padding="lg">
      <SummaryMediaLayout
        aside={(
          <MetricGrid className="grid-cols-2 sm:grid-cols-2">
            <MetricTile label="Members" value={memberCount} />
            <MetricTile label="Active contests" value={activeContestCount} />
          </MetricGrid>
        )}
      >
        <div className="space-y-3">
          <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {roleLabel}
          </span>
          <div className="flex items-start gap-4">
            <IconAvatar label={`${name} icon`} size="lg">
              {icon}
            </IconAvatar>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{name}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {description?.trim() ||
                  "Manage league identity, commissioner controls, and member actions here."}
              </p>
            </div>
          </div>
        </div>
      </SummaryMediaLayout>
    </Tile>
  );
}
