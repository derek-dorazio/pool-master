import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { DataGrid, DetailEditModal, SectionCard, type Fact } from '@/features/shared/ui';
import type { SportLeaguePositionDto } from '@/lib/api';
import { providerCodeText } from './league-structure-rows';

const columnHelper = createColumnHelper<SportLeaguePositionDto>();

/** The Positions grid's columns, each explained behind its (i). */
const positionColumns = [
  columnHelper.accessor('code', {
    header: 'Position',
    meta: { info: 'The position\'s code in its league, listed in the league\'s own order. ⤢ opens it.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('isFieldEligible', {
    header: 'In fields',
    meta: { info: 'Whether the position\'s players can be picked into an event\'s field. The roster sync keeps only these players.', type: { kind: 'boolean' } },
    cell: ({ getValue }) => (getValue() ? 'Yes' : 'No'),
  }),
  columnHelper.accessor((position) => position.providerCodes.map(providerCodeText).join(', '), {
    id: 'providerCodes',
    header: 'Provider codes',
    meta: { info: 'Each provider\'s code for the position. Blank: no feed names it.', type: { kind: 'text' } },
  }),
];

/**
 * The Structure tab's Positions section (#2001): the league's playing positions by display order,
 * set by migration; ⤢ opens one to read with its provider codes.
 */
export function LeagueStructurePositionsSection({ positions }: { positions: readonly SportLeaguePositionDto[] }) {
  const [openPositionId, setOpenPositionId] = useState<string | null>(null);
  const openPosition = positions.find((position) => position.id === openPositionId);

  return (
    <SectionCard padded testId="root-admin-league-structure-positions" title="Positions">
      <DataGrid
        columns={positionColumns}
        data={[...positions]}
        emptyMessage="No positions for this league."
        filterTestIdPrefix="root-admin-league-structure-positions-filter"
        getRowId={(position) => position.id}
        openRowDialog={(position) => setOpenPositionId(position.id)}
        rowTestId={(position) => `root-admin-league-structure-position-${position.code}`}
        tableTestId="root-admin-league-structure-positions-table"
        urlKey="positions"
      />
      {openPosition ? <PositionDialog onClose={() => setOpenPositionId(null)} position={openPosition} /> : null}
    </SectionCard>
  );
}

/** A position to read, with no Edit: migrations own these rows. */
function PositionDialog({ onClose, position }: { onClose: () => void; position: SportLeaguePositionDto }) {
  const facts: Fact[] = [
    { id: 'code', label: 'Position', value: position.code },
    { id: 'field-eligible', label: 'In fields', value: position.isFieldEligible ? 'Yes' : 'No' },
    {
      id: 'provider-codes',
      label: 'Provider codes',
      testId: 'root-admin-league-structure-position-codes',
      value: position.providerCodes.length === 0 ? 'No provider' : position.providerCodes.map(providerCodeText).join(', '),
    },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId="root-admin-league-structure-position"
      title={position.code}
    />
  );
}
