import type { ContestStatus } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { StatusBadge, type StatusBadgeProps } from '@/features/shared/ui';
import { CONTEST_STATUS_TONES } from './contest-status';

/** A contest's status as members read it, in its own colour, the same on every contest page. */
export function ContestStatusBadge({
  status,
  ...props
}: Omit<StatusBadgeProps, 'tone' | 'children'> & { status: ContestStatus }) {
  return (
    <StatusBadge tone={CONTEST_STATUS_TONES[status]} {...props}>
      {enumLabel('ContestStatus', status)}
    </StatusBadge>
  );
}

