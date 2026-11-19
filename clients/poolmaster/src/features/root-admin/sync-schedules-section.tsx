import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SyncScheduleDialog } from './sync-schedule-dialog';
import { syncScheduleColumns } from './sync-schedule-columns';
import { syncScheduleRows, type SyncScheduleKey } from './sync-schedule-rows';
import { useSettingsGroupQuery } from './use-settings-groups';

/**
 * The Providers page's sync schedules (#1873): the one schedule every sport league follows, a row
 * per sync, each opening its dialog to see and edit it. Read as its settings group, which says who
 * last changed it.
 */
export function SyncSchedulesSection() {
  const scheduleQuery = useSettingsGroupQuery('INGESTION_SCHEDULE_CONFIG');
  const [openKey, setOpenKey] = useState<SyncScheduleKey | null>(null);
  const group = scheduleQuery.data;
  const rows = useMemo(() => (group ? syncScheduleRows(group.value) : []), [group]);
  const openRow = rows.find((row) => row.key === openKey);

  return (
    <SectionCard padded testId="root-admin-sync-schedules" title="Sync schedules">
      <QueryState
        error={extractErrorMessage(scheduleQuery.error, { fallback: 'We could not load the sync schedules right now.' })}
        loading="Loading sync schedules..."
        query={scheduleQuery}
        testId="root-admin-sync-schedules-state"
      >
        {() => (
          <DataGrid
            columns={syncScheduleColumns}
            data={rows}
            emptyMessage="No sync schedules."
            filterTestIdPrefix="root-admin-sync-schedules-filter"
            getRowId={(row) => row.key}
            openRowDialog={(row) => setOpenKey(row.key)}
            rowTestId={(row) => `root-admin-sync-schedule-${row.key}`}
            tableTestId="root-admin-sync-schedules-table"
            urlKey="syncSchedules"
          />
        )}
      </QueryState>
      {openRow && group ? (
        <SyncScheduleDialog
          key={openRow.key}
          lastChange={group.updatedAt === null ? null : { at: group.updatedAt, by: group.updatedBy }}
          onClose={() => setOpenKey(null)}
          row={openRow}
        />
      ) : null}
    </SectionCard>
  );
}
