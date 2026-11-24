import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { LeaguePhaseOrder, MatchFormatOrder, SlotKindOrder, SlotPairingOrder, type LeaguePhase, type MatchFormat, type SlotKind, type SlotPairing } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { DataGrid, SectionCard, Text } from '@/features/shared/ui';
import { LeagueSlotDialog } from './league-slot-dialog';
import { mappingText, periodsText, seriesText, type SlotDefinitionRow } from './league-structure-rows';

const columnHelper = createColumnHelper<SlotDefinitionRow>();

/** The Slot definitions grid's columns, each explained behind its (i). */
const slotColumns = [
  columnHelper.accessor((slot) => slotLabel(slot), {
    id: 'slot',
    header: 'Slot',
    meta: { info: 'A week, a knockout round or a recurring tournament: its own name, else the word for its kind. ⤢ opens it.', type: { kind: 'text' } },
    cell: ({ getValue }) => <Text variant="strong">{getValue()}</Text>,
  }),
  columnHelper.accessor('phase', {
    header: 'Phase',
    meta: { info: 'The phase the slot is in.', type: { kind: 'enum', order: LeaguePhaseOrder, label: (phase) => enumLabel('LeaguePhase', phase as LeaguePhase) } },
    cell: ({ getValue }) => enumLabel('LeaguePhase', getValue()),
  }),
  columnHelper.accessor('slotKind', {
    header: 'Kind',
    meta: { info: 'What the slot is in its phase; with a week\'s number, its place in play.', type: { kind: 'enum', order: SlotKindOrder, label: (kind) => enumLabel('SlotKind', kind as SlotKind) } },
    cell: ({ getValue }) => enumLabel('SlotKind', getValue()),
  }),
  columnHelper.accessor('key', {
    header: 'Key',
    meta: { info: 'The code Seasons, events and contest templates link on.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((slot) => seriesText(slot), {
    id: 'series',
    header: 'Series',
    meta: { info: 'How one meeting in the slot is decided, which each Season copies.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('matchFormat', {
    header: 'Format',
    meta: { info: 'How the slot\'s games are contested: two sides meeting, or a whole field ranked.', type: { kind: 'enum', order: MatchFormatOrder, label: (format) => enumLabel('MatchFormat', format as MatchFormat) } },
    cell: ({ getValue }) => enumLabel('MatchFormat', getValue()),
  }),
  columnHelper.accessor('canEndTied', {
    header: 'Can tie',
    meta: { info: 'Whether a game of the slot can finish level. One that cannot is decided by overtime or a shoot-out.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor((slot) => periodsText(slot), {
    id: 'periods',
    header: 'Periods',
    meta: { info: 'What a game of the slot is played in, and how many, overtime aside.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('pairing', {
    header: 'Pairing',
    meta: { info: 'How the slot\'s winners meet in the next slot.', type: { kind: 'enum', order: SlotPairingOrder, label: (pairing) => enumLabel('SlotPairing', pairing as SlotPairing) } },
    cell: ({ getValue }) => enumLabel('SlotPairing', getValue()),
  }),
  columnHelper.accessor('awardsTrophy', {
    header: 'Trophy',
    meta: { info: 'Whether winning the slot wins a trophy.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor('squaresEligible', {
    header: 'Squares',
    meta: { info: 'Whether a squares pool can be played on the slot\'s games.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor((slot) => slot.providerMappings.map(mappingText).join(', '), {
    id: 'mappings',
    header: 'Matched by',
    meta: { info: 'How each provider\'s games are matched to the slot. Blank: no provider\'s games are synced into it.', type: { kind: 'text' } },
  }),
];

/**
 * The Structure tab's Slot definitions section (#2002): every phase's slots in play order, set by
 * migration; ⤢ opens one to read with its provider mappings.
 */
export function LeagueStructureSlotsSection({ slots }: { slots: readonly SlotDefinitionRow[] }) {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const openSlot = slots.find((slot) => slot.id === openSlotId);

  return (
    <SectionCard padded testId="root-admin-league-structure-slots" title="Slot definitions">
      <DataGrid
        columns={slotColumns}
        data={[...slots]}
        emptyMessage="No slot definitions for this league."
        filterTestIdPrefix="root-admin-league-structure-slots-filter"
        getRowId={(slot) => slot.id}
        openRowDialog={(slot) => setOpenSlotId(slot.id)}
        rowTestId={(slot) => `root-admin-league-structure-slot-${slot.key}`}
        tableTestId="root-admin-league-structure-slots-table"
        urlKey="slots"
      />
      {openSlot ? <LeagueSlotDialog onClose={() => setOpenSlotId(null)} slot={openSlot} /> : null}
    </SectionCard>
  );
}
