import type { CupDto } from '@/lib/api';
import { ListCard, ProgressIndicator } from '@/features/shared/ui';
import { cupProgress, describeCupStanding, isCupSeasonOver } from './cup-view';

/**
 * One sports league cup at a glance: its name, who leads, the focus squad's place and, until its
 * season is over, how many of its contests are final. It opens the cup's Points race.
 */
export function CupSummaryCard({
  cup,
  focus,
  to,
}: {
  cup: CupDto;
  focus: { squadId: string | null; isViewer: boolean };
  to: string;
}) {
  const progress = cupProgress(cup);
  return (
    <ListCard
      data-testid={`cup-card-${cup.id}`}
      description={describeCupStanding(cup, focus)}
      metadata={isCupSeasonOver(cup, new Date()) ? undefined : (
        <ProgressIndicator
          className="mt-3"
          label={`${progress.final} of ${progress.total} contests final`}
          max={progress.total}
          value={progress.final}
        />
      )}
      title={cup.name}
      to={to}
    />
  );
}
