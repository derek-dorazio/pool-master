import { createColumnHelper } from '@tanstack/react-table';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { LeaguePhaseOrder, type LeaguePhase } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { DataGrid, DetailEditModal, SectionCard, type Fact } from '@/features/shared/ui';
import type { SportLeaguePhaseDefinitionDto } from '@/lib/api';

const columnHelper = createColumnHelper<SportLeaguePhaseDefinitionDto>();

/** The Phases grid's columns, each explained behind its (i). */
const phaseColumns = [
  columnHelper.accessor('phase', {
    header: 'Phase',
    meta: {
      info: 'A part of every Season, in the order a Season plays them. ⤢ opens it.',
      type: { kind: 'enum', order: LeaguePhaseOrder, label: (phase) => enumLabel('LeaguePhase', phase as LeaguePhase) },
    },
    cell: ({ getValue }) => enumLabel('LeaguePhase', getValue()),
  }),
  columnHelper.accessor('isSynced', {
    header: 'Synced',
    meta: { info: 'Whether the league\'s sync reads the phase. An unsynced phase has no slots, events or findings.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor((phase) => phase.slots.length, {
    id: 'slots',
    header: 'Slots',
    meta: { info: 'How many slot definitions the phase has.', type: { kind: 'number' } },
  }),
];

/** The Structure tab's Phases section (#2002): the league's phases, set by migration; ⤢ opens one to read. */
export function LeagueStructurePhasesSection({ phases }: { phases: readonly SportLeaguePhaseDefinitionDto[] }) {
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const openPhase = phases.find((phase) => phase.id === openPhaseId);

  return (
    <SectionCard padded testId="root-admin-league-structure-phases" title="Phases">
      <DataGrid
        columns={phaseColumns}
        data={[...phases]}
        emptyMessage="No phases for this league."
        filterTestIdPrefix="root-admin-league-structure-phases-filter"
        getRowId={(phase) => phase.id}
        openRowDialog={(phase) => setOpenPhaseId(phase.id)}
        rowTestId={(phase) => `root-admin-league-structure-phase-${phase.phase}`}
        tableTestId="root-admin-league-structure-phases-table"
        urlKey="phases"
      />
      {openPhase ? <PhaseDialog onClose={() => setOpenPhaseId(null)} phase={openPhase} /> : null}
    </SectionCard>
  );
}

/** A phase to read, with no Edit: migrations own these rows. */
function PhaseDialog({ onClose, phase }: { onClose: () => void; phase: SportLeaguePhaseDefinitionDto }) {
  const facts: Fact[] = [
    { id: 'phase', label: 'Phase', value: enumLabel('LeaguePhase', phase.phase) },
    { id: 'synced', label: 'Synced', value: phase.isSynced ? 'Yes' : 'No' },
    { id: 'slots', label: 'Slots', value: String(phase.slots.length) },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId="root-admin-league-structure-phase"
      title={enumLabel('LeaguePhase', phase.phase)}
    />
  );
}
