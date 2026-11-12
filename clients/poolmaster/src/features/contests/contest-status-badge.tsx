import type { ContestStatus } from '@poolmaster/shared/domain';
import { StatusBadge, type StatusBadgeProps } from '@/features/shared/ui';
import { contestLifecycleStage } from './contest-lifecycle';
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

/**
 * A contest's lifecycle stage on Manage contest's header (Set up, Open, Live, Final), in its
 * status's colour: the same stage its lifecycle panel's track shows as current.
 */
export function ContestStageBadge({
  status,
  ...props
}: Omit<StatusBadgeProps, 'tone' | 'children'> & { status: ContestStatus }) {
  return (
    <StatusBadge tone={CONTEST_STATUS_TONES[status]} {...props}>
      {contestLifecycleStage(status).label}
    </StatusBadge>
  );
}
