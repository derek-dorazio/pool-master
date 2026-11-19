import { SectionCard } from '@/features/shared/ui';
import { ActivityGrid } from './activity-grid';
import { useEventPage } from './event-page-context';

/**
 * The Event page's Activity tab (#1890): the shared Activity grid scoped to the event, so it
 * shows the event's own jobs, without the Sport league and Event columns.
 */
export function EventActivityTab() {
  const { activity } = useEventPage();
  return (
    <SectionCard padded testId="root-admin-event-activity" title="Jobs">
      <ActivityGrid activity={activity} />
    </SectionCard>
  );
}
