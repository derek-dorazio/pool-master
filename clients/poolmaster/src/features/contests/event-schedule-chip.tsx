import { MatchStatus, type SportEventStatus } from '@poolmaster/shared/domain';
import { Chip } from '@/features/shared/ui';

/**
 * A game, week or round that is not going ahead as scheduled (#1768), the same on every board and
 * pick screen: a gold Postponed chip, or a grey Cancelled one. Nothing for any other status. A
 * game takes its own status (#1791), an event or week its event's, which is never postponed: a
 * postponement is a Game's (#2013).
 */
export function EventScheduleChip({ status, testId }: { status: SportEventStatus | MatchStatus; testId: string }) {
  if (status === MatchStatus.POSTPONED) {
    return <Chip data-testid={testId} tone="warning">Postponed</Chip>;
  }
  if (status === MatchStatus.CANCELLED) {
    return <Chip data-testid={testId} tone="neutral">Cancelled</Chip>;
  }
  return null;
}
