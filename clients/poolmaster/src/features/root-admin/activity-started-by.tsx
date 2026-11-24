import { enumLabel } from '@poolmaster/shared/display-strings';
import { DetailsPeek, PeekCard } from '@/features/shared/ui';
import type { ActivityJobDto } from '@/lib/api';

/** Who started a job: the trigger, with an admin's or commissioner's name on hover. */
export function ActivityStartedBy({ job }: { job: ActivityJobDto }) {
  const label = enumLabel('JobTrigger', job.trigger);
  if (!job.startedBy) return label;
  return (
    <DetailsPeek icon={label} label={`Started by ${job.startedBy.displayName}`} testId={`activity-started-by-${job.id}`} trigger="text">
      <PeekCard facts={[]} subtitle={label} title={job.startedBy.displayName} />
    </DetailsPeek>
  );
}
