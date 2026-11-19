import { SectionCard } from '@/features/shared/ui';
import { ActivityGrid } from './activity-grid';
import { useLeaguePage } from './league-page-context';

/**
 * The League page's Activity tab (#1866): the shared Activity grid scoped to the league, so it
 * shows the league's own jobs and the jobs on its events, without the Sport league column.
 */
export function LeagueActivityTab() {
  const { activity } = useLeaguePage();
  return (
    <SectionCard padded testId="root-admin-league-activity" title="Jobs">
      <ActivityGrid activity={activity} />
    </SectionCard>
  );
}
