import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { SeasonSlotStatusOrder, SlotKindOrder, type SeasonSlotStatus, type SlotKind } from '@poolmaster/shared/domain';
import { useState } from 'react';
import {
  DataGrid,
  DetailEditModal,
  formatDateTimeDisplay,
  SectionCard,
  Text,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import type { SportLeagueSeasonSlotDto } from '@/lib/api';
import { useEventPage } from './event-page-context';

const columnHelper = createColumnHelper<SportLeagueSeasonSlotDto>();

/** The Slots grid's columns, each explained behind its (i). */
const slotColumns = [
  columnHelper.accessor((slot) => slotLabel(slot), {
    id: 'slot',
    header: 'Slot',
    meta: { info: 'The slot definition it plays: its own name, else the word for its kind. ⤢ opens it.', type: { kind: 'text' } },
    cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
  }),
  columnHelper.accessor('slotKind', {
    header: 'Kind',
    meta: { info: 'What the slot is in its phase.', type: { kind: 'enum', order: SlotKindOrder, label: (kind) => enumLabel('SlotKind', kind as SlotKind) } },
    cell: ({ getValue }) => enumLabel('SlotKind', getValue()),
  }),
  columnHelper.accessor('startsAt', {
    header: 'Starts',
    meta: { info: 'The earliest start of its games, which the event\'s start is. Blank until the sync has matched one.', type: { kind: 'datetime', direction: 'both' } },
  }),
  columnHelper.accessor('endsAt', {
    header: 'Ends',
    meta: { info: 'The latest end of its games, which the event\'s end is. Blank until known.', type: { kind: 'datetime', direction: 'both' } },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    meta: { info: 'Where the slot is in its Season.', type: { kind: 'enum', order: SeasonSlotStatusOrder, label: (status) => enumLabel('SeasonSlotStatus', status as SeasonSlotStatus) } },
    cell: ({ getValue }) => enumLabel('SeasonSlotStatus', getValue()),
  }),
  columnHelper.accessor('label', {
    header: 'Test label',
    meta: { info: 'A test slot\'s label: QA only, never read or written by the sync. Blank on a synced slot.', type: { kind: 'text' } },
    cell: ({ getValue }) => getValue() ?? '',
  }),
];

/**
 * The Event page's Slots tab (#2004): the Season slots the event covers, in play order, which its
 * dates come from. ⤢ opens one to read; nothing here edits a slot.
 */
export function EventSlotsTab() {
  const { event } = useEventPage();
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const openSlot = event.slots.find((slot) => slot.id === openSlotId);

  return (
    <SectionCard padded testId="root-admin-event-slots" title="Slots">
      <DataGrid
        columns={slotColumns}
        data={event.slots}
        emptyMessage="This event covers no Season slot yet."
        filterTestIdPrefix="root-admin-event-slots-filter"
        getRowId={(slot) => slot.id}
        openRowDialog={(slot) => setOpenSlotId(slot.id)}
        rowTestId={(slot) => `root-admin-event-slot-${slot.id}`}
        tableTestId="root-admin-event-slots-table"
        urlKey="slots"
      />
      {openSlot ? <EventSlotDialog onClose={() => setOpenSlotId(null)} slot={openSlot} /> : null}
    </SectionCard>
  );
}

/** One slot to read, with no Edit: the sync owns a synced slot, and a test slot is fixed once made. */
function EventSlotDialog({ onClose, slot }: { onClose: () => void; slot: SportLeagueSeasonSlotDto }) {
  const preferences = useDisplayPreferences();
  const testId = 'root-admin-event-slot-dialog';
  const facts: Fact[] = [
    { id: 'slot', label: 'Slot', value: slotLabel(slot), testId: `${testId}-slot` },
    { id: 'kind', label: 'Kind', value: enumLabel('SlotKind', slot.slotKind), testId: `${testId}-kind` },
    { id: 'starts', label: 'Starts', value: formatDateTimeDisplay(slot.startsAt, preferences, 'Not known yet'), testId: `${testId}-starts` },
    { id: 'ends', label: 'Ends', value: formatDateTimeDisplay(slot.endsAt, preferences, 'Not known yet'), testId: `${testId}-ends` },
    { id: 'status', label: 'Status', value: enumLabel('SeasonSlotStatus', slot.status), testId: `${testId}-status` },
    { id: 'series', label: 'Series', value: `${enumLabel('SeriesFormat', slot.seriesFormat)} · ${String(slot.seriesGames)}`, testId: `${testId}-series` },
    { id: 'pairing', label: 'Pairing', value: enumLabel('SlotPairing', slot.pairing), testId: `${testId}-pairing` },
    { id: 'test', label: 'Test label', value: slot.label ?? 'Synced slot', testId: `${testId}-label` },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId={testId}
      title={slotLabel(slot)}
    />
  );
}
