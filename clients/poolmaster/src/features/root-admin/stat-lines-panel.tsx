import { Alert } from '@/features/shared/ui';
import type { SportEventDto } from '@/lib/api';

/**
 * A stat pool event's results page (#934). Its players' stat lines are loaded with the sport data
 * files; checking and correcting them on this page is the stat grid's (#935).
 */
export function StatLinesPanel({ event }: { event: SportEventDto }) {
  return (
    <Alert tone="info" title="Stats" data-testid={`stat-lines-panel-${event.id}`}>
      Each game&apos;s player stats are loaded with the event&apos;s box score file.
    </Alert>
  );
}
