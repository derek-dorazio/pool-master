import type { ContestStatus } from '@poolmaster/shared/domain';
import { StatusBadge, type StatusBadgeProps } from '@/features/shared/ui';
import { CONTEST_STATUS_TONES, contestStatusLabel } from './contest-status';

/** A contest's status as members read it, in its own colour, the same on every contest page. */
export function ContestStatusBadge({
  status,
  ...props
}: Omit<StatusBadgeProps, 'tone' | 'children'> & { status: ContestStatus }) {
  return (
    <StatusBadge tone={CONTEST_STATUS_TONES[status]} {...props}>
      {contestStatusLabel(status)}
    </StatusBadge>
  );
}
