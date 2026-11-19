import { useMemo, useState, type ReactNode } from 'react';
import type { SportEventDto, SportEventOverviewDto, SportEventTierDto } from '@/lib/api';
import { DataGrid, SectionCard } from '@/features/shared/ui';
import { eventFieldColumns } from './event-field-columns';
import type { EventFieldEntry } from './event-field-patch';
import { eventFieldColumnsShown, eventFieldRows } from './event-field-rows';
import { EventParticipantDialog } from './event-participant-dialog';

/**
 * The Event page's Field section (#1890): every field row, withdrawn ones too, read-only, with
 * its tier, price, who set them and when the feed last listed it. ⤢ opens the participant to
 * withdraw it or correct it.
 */
export function EventFieldGridCard({
  actions,
  event,
  field,
  isSynced,
  overview,
  tiers,
}: {
  /** The section's own actions, such as automatic tiers and prices, beside its title. */
  actions?: ReactNode;
  event: SportEventDto;
  field: readonly EventFieldEntry[];
  isSynced: boolean;
  overview: SportEventOverviewDto | undefined;
  tiers: readonly SportEventTierDto[];
}) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const rows = useMemo(() => eventFieldRows(field, tiers, overview?.fieldFeed ?? []), [field, tiers, overview?.fieldFeed]);
  const shown = eventFieldColumnsShown(rows, isSynced);
  const columns = useMemo(
    () => eventFieldColumns({ team: shown.team, country: shown.country, seed: shown.seed, lastInFeed: shown.lastInFeed }),
    [shown.team, shown.country, shown.seed, shown.lastInFeed],
  );
  const openRow = openRowId === null ? undefined : rows.find((row) => row.id === openRowId);
  const activeCount = field.filter((entry) => entry.isActive).length;

  return (
    <SectionCard
      headingLevel={3}
      testId="root-admin-event-field"
      title={`Field (${String(activeCount)})`}
      trailing={actions}
    >
      <DataGrid
        columns={columns}
        data={rows}
        emptyMessage="No participants in the field yet."
        getRowId={(row) => row.id}
        openRowDialog={(row) => setOpenRowId(row.id)}
        rowTestId={(row) => `root-admin-event-field-row-${row.id}`}
        tableTestId="root-admin-event-field-table"
        urlKey="field"
      />
      {openRow === undefined ? null : (
        <EventParticipantDialog
          event={event}
          field={field}
          isSynced={isSynced}
          key={openRow.id}
          onClose={() => setOpenRowId(null)}
          row={openRow}
          tiers={tiers}
        />
      )}
    </SectionCard>
  );
}
