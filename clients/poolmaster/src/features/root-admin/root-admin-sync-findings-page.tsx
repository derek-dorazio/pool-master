import { useState } from 'react';
import { DataGrid, HelpTip, PageHeader, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { syncFindingColumns } from './sync-finding-columns';
import { SyncFindingDialog } from './sync-finding-dialog';
import { SYNC_FINDINGS_GRID_KEY } from './sync-findings-links';
import { useSyncFindingsQuery } from './use-sync-findings';

/**
 * /manage/providers/findings (#1999): the one list of problems the sync found, across every sport
 * league, open ones first by default. A row opens its dialog, with its details and what can be
 * done about it. Root admin, desktop only.
 */
export function RootAdminSyncFindingsPage() {
  const findingsQuery = useSyncFindingsQuery();
  const [openFindingId, setOpenFindingId] = useState<string | null>(null);
  // poolmaster-allow-list-lookup: the findings list is read whole and held in the cache
  const openFinding = findingsQuery.data?.find((finding) => finding.id === openFindingId);

  return (
    <section className="space-y-6" data-testid="root-admin-sync-findings-page">
      <PageHeader
        testId="root-admin-sync-findings-header"
        title="Findings"
        titleAside={(
          <HelpTip label="About findings" testId="root-admin-sync-findings-help">
            What the sync found that needs a look: a participant the feed sent that nothing maps, a
            provider set up wrongly. Each one is raised once and updated each time the sync sees it.
            Resolved findings are cleared after 90 days.
          </HelpTip>
        )}
      />
      <SectionCard padded testId="root-admin-sync-findings" title="Sync findings">
        <QueryState
          error={extractErrorMessage(findingsQuery.error, { fallback: 'We could not load the findings right now.' })}
          loading="Loading findings..."
          query={findingsQuery}
          testId="root-admin-sync-findings-state"
        >
          {(findings) => (
            <DataGrid
              columns={syncFindingColumns}
              data={findings}
              emptyMessage="The sync has found nothing that needs a look."
              filterTestIdPrefix="root-admin-sync-findings-filter"
              getRowId={(finding) => finding.id}
              openRowDialog={(finding) => setOpenFindingId(finding.id)}
              rowTestId={(finding) => `root-admin-sync-finding-${finding.id}`}
              tableTestId="root-admin-sync-findings-table"
              urlKey={SYNC_FINDINGS_GRID_KEY}
            />
          )}
        </QueryState>
      </SectionCard>
      {openFinding ? <SyncFindingDialog finding={openFinding} onClose={() => setOpenFindingId(null)} /> : null}
    </section>
  );
}
