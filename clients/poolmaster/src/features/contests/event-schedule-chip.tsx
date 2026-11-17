import { SportEventStatus } from '@poolmaster/shared/domain';
import { Chip } from '@/features/shared/ui';

/**
 * A game, week or round that is not going ahead as scheduled (#1768), the same on every board and
 * pick screen: a gold Postponed chip, or a grey Cancelled one. Nothing for any other status.
 */
export function EventScheduleChip({ status, testId }: { status: SportEventStatus; testId: string }) {
  if (status === SportEventStatus.POSTPONED) {
    return <Chip data-testid={testId} tone="warning">Postponed</Chip>;
  }
  if (status === SportEventStatus.CANCELLED) {
    return <Chip data-testid={testId} tone="neutral">Cancelled</Chip>;
  }
  return null;
}
