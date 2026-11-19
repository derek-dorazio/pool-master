import { PageHeader, SectionCard } from '@/features/shared/ui';
import { ActivityGrid } from './activity-grid';
import { activityCountLine, useActivity } from './use-activity';

/**
 * /manage/activity (#1887): every background job, in the same Activity grid a sport league's and
 * an event's Activity tabs show, unscoped. It replaces the old sync run history page. Root admin,
 * desktop only.
 */
export function RootAdminActivityPage() {
  const activity = useActivity(null);
  const jobs = activity.query.data;
  return (
    <section className="space-y-6" data-testid="root-admin-activity-page">
      <PageHeader
        meta={jobs ? <span data-testid="root-admin-activity-counts">{activityCountLine(jobs)}</span> : undefined}
        testId="root-admin-activity-header"
        title="Activity"
      />
      <SectionCard padded testId="root-admin-activity-jobs" title="Jobs">
        <ActivityGrid activity={activity} />
      </SectionCard>
    </section>
  );
}
